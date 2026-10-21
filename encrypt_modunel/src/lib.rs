use wasm_bindgen::prelude::*;
use rsa::{RsaPublicKey, Oaep, pkcs8::DecodePublicKey};
use rand::{rngs::OsRng, RngCore};
use sha2::Sha256;
use aes_gcm::{Aes256Gcm, KeyInit, aead::{Aead, Payload}, Nonce};
include!(concat!(env!("OUT_DIR"), "/key.rs"));
include!(concat!(env!("OUT_DIR"), "/response.rs"));

fn browser_id() -> Result<String, JsValue> {
    let window = web_sys::window().ok_or_else(|| JsValue::from_str("Browser required"))?;
    let document = window.document().ok_or_else(|| JsValue::from_str("Document required"))?;
    let canvas = document.create_element("canvas")?.dyn_into::<web_sys::HtmlCanvasElement>()?;
    canvas.set_width(240);
    canvas.set_height(60);
    let ctx = canvas.get_context("2d")?.ok_or_else(|| JsValue::from_str("Canvas required"))?.dyn_into::<web_sys::CanvasRenderingContext2d>()?;
    ctx.set_fill_style_str("#365563");
    ctx.fill_rect(0.0, 0.0, 240.0, 60.0);
    ctx.set_font("18px sans-serif");
    ctx.set_fill_style_str("#e7bd66");
    ctx.fill_text("Xếp hàng lên tàu ⚓", 8.0, 35.0)?;
    let navigator = window.navigator();
    let options = js_sys::Intl::DateTimeFormat::new(&js_sys::Array::new(), &js_sys::Object::new()).resolved_options();
    let zone = js_sys::Reflect::get(&options, &JsValue::from_str("timeZone"))?.as_string().unwrap_or_default();
    let signals = serde_json::json!([
        canvas.to_data_url()?, navigator.language(), navigator.platform()?,
        navigator.hardware_concurrency() as u32, window.screen()?.color_depth()?, zone
    ]).to_string();
    Ok(format!("{:x}", md5::compute(signals)))
}

// Versioned binary envelope: version | RSA key length | RSA key | IV | GCM payload.
fn encrypt_payload(endpoint: &str, payload: &str) -> Result<Vec<u8>, JsValue> {
    let mut data: serde_json::Value = serde_json::from_str(payload).map_err(|_| JsValue::from_str("Invalid payload"))?;
    let body = data.get_mut("body").and_then(|v| v.as_object_mut()).ok_or_else(|| JsValue::from_str("Body must be an object"))?;
    body.insert("browserId".into(), browser_id()?.into());
    let payload = data.to_string();
    let der: Vec<u8> = MASKED.iter().enumerate().map(|(i, b)| b ^ ((i * 73 + 159) as u8)).collect();
    let public = RsaPublicKey::from_public_key_der(&der).map_err(|_| JsValue::from_str("Invalid build key"))?;
    let mut key = [0u8; 32];
    let mut iv = [0u8; 12];
    OsRng.fill_bytes(&mut key);
    OsRng.fill_bytes(&mut iv);
    let wrapped = public.encrypt(&mut OsRng, Oaep::new::<Sha256>(), &key).map_err(|_| JsValue::from_str("RSA encryption failed"))?;
    let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
    let encrypted = cipher.encrypt(Nonce::from_slice(&iv), Payload { msg: payload.as_bytes(), aad: endpoint.as_bytes() }).map_err(|_| JsValue::from_str("Encryption failed"))?;
    let mut out = vec![1];
    out.extend_from_slice(&(wrapped.len() as u16).to_be_bytes());
    out.extend(wrapped);
    out.extend(iv);
    out.extend(encrypted);
    Ok(out)
}

#[wasm_bindgen(js_name = sendApi)]
pub async fn send_api(endpoint: String, body: JsValue) -> Result<JsValue, JsValue> {
    if !matches!(endpoint.as_str(), "/api/player" | "/api/score" | "/api/leaderboard") {
        return Err(js_sys::Error::new("Invalid API endpoint").into());
    }
    let window = web_sys::window().ok_or_else(|| js_sys::Error::new("Browser required"))?;
    let origin = window.location().origin()?;
    let url = format!("{origin}{endpoint}");
    let client = reqwest::Client::new();
    let response_key: Vec<u8> = RESPONSE_MASKED.iter().enumerate().map(|(i, b)| b ^ ((i * 37 + 93) as u8)).collect();
    let request = if body.is_undefined() {
        client.get(&url)
    } else {
        let json = js_sys::JSON::stringify(&body)?.as_string()
            .ok_or_else(|| js_sys::Error::new("Invalid request body"))?;
        let parsed: serde_json::Value = serde_json::from_str(&json)
            .map_err(|_| js_sys::Error::new("Invalid request body"))?;
        let payload = serde_json::json!({ "time": js_sys::Date::now(), "body": parsed }).to_string();
        let encrypted = encrypt_payload(&endpoint, &payload)
            .map_err(|error| js_sys::Error::new(&error.as_string().unwrap_or_else(|| "Encryption failed".into())))?;
        client.post(&url).header("Content-Type", "application/octet-stream").body(encrypted)
    };
    let response = request.send().await.map_err(|e| js_sys::Error::new(&e.to_string()))?;
    let success = response.status().is_success();
    let bytes = response.bytes().await.map_err(|e| js_sys::Error::new(&e.to_string()))?;
    if bytes.len() < 29 || bytes[0] != 1 {
        return Err(js_sys::Error::new("Invalid encrypted response").into());
    }
    let cipher = Aes256Gcm::new_from_slice(&response_key).unwrap();
    let aad = format!("response:{endpoint}");
    let plain = cipher.decrypt(Nonce::from_slice(&bytes[1..13]), Payload { msg: &bytes[13..], aad: aad.as_bytes() })
        .map_err(|_| js_sys::Error::new("Response verification failed"))?;
    let text = String::from_utf8(plain).map_err(|_| js_sys::Error::new("Invalid response encoding"))?;
    let result = js_sys::JSON::parse(&text)?;
    if !success {
        let message = js_sys::Reflect::get(&result, &JsValue::from_str("error"))?.as_string()
            .unwrap_or_else(|| "Không thể gửi dữ liệu.".into());
        return Err(js_sys::Error::new(&message).into());
    }
    Ok(result)
}
