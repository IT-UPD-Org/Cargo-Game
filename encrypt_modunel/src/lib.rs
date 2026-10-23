use wasm_bindgen::prelude::*;
use rsa::{RsaPublicKey, Oaep, pkcs8::DecodePublicKey};
use rand::{rngs::OsRng, RngCore};
use sha2::Sha256;
use aes_gcm::{Aes256Gcm, KeyInit, aead::{Aead, Payload}, Nonce};
include!(concat!(env!("OUT_DIR"), "/key.rs"));
include!(concat!(env!("OUT_DIR"), "/response.rs"));

const SEED_KEY: &str = "cargoDeviceSeed";
const SESSION_KEY: &str = "cargoSession";

thread_local! {
    static BROWSER_ID: std::cell::RefCell<Option<String>> = std::cell::RefCell::new(None);
}

// Random per-device value. Identical phones share every hardware signal, so this is what tells them apart.
// If storage is blocked or purged we still use a fresh in-memory seed so devices can never collide;
// the server's login cookie then restores the player.
fn device_seed(window: &web_sys::Window) -> String {
    let storage = window.local_storage().ok().flatten();
    if let Some(store) = &storage {
        if let Ok(Some(saved)) = store.get_item(SEED_KEY) {
            if saved.len() == 32 && saved.bytes().all(|b| b.is_ascii_hexdigit()) { return saved; }
        }
    }
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    let seed: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    if let Some(store) = &storage { let _ = store.set_item(SEED_KEY, &seed); }
    seed
}

fn webgl_signals(document: &web_sys::Document) -> String {
    use web_sys::WebGlRenderingContext as Gl;
    let gl = document.create_element("canvas").ok()
        .and_then(|c| c.dyn_into::<web_sys::HtmlCanvasElement>().ok())
        .and_then(|c| c.get_context("webgl").ok().flatten())
        .and_then(|c| c.dyn_into::<Gl>().ok());
    let Some(gl) = gl else { return "no-webgl".into() };
    let text = |param: u32| gl.get_parameter(param).ok().and_then(|v| v.as_string()).unwrap_or_default();
    let number = |param: u32| gl.get_parameter(param).ok().and_then(|v| v.as_f64()).unwrap_or(0.0);
    let mut parts = vec![text(Gl::VENDOR), text(Gl::RENDERER), text(Gl::VERSION), text(Gl::SHADING_LANGUAGE_VERSION), number(Gl::MAX_TEXTURE_SIZE).to_string()];
    if gl.get_extension("WEBGL_debug_renderer_info").ok().flatten().is_some() {
        parts.push(text(0x9245)); // UNMASKED_VENDOR_WEBGL
        parts.push(text(0x9246)); // UNMASKED_RENDERER_WEBGL
    }
    parts.join("|")
}

// A font counts as installed when it changes the measured width against any generic fallback.
fn font_signals(ctx: &web_sys::CanvasRenderingContext2d) -> String {
    const FONTS: [&str; 16] = ["Arial", "Helvetica", "Times New Roman", "Courier New", "Georgia", "Verdana", "Trebuchet MS", "Impact",
        "Comic Sans MS", "Tahoma", "Roboto", "Noto Sans", "Segoe UI", "Menlo", "Ubuntu", "Apple Color Emoji"];
    const BASES: [&str; 3] = ["monospace", "sans-serif", "serif"];
    let sample = "mmMwWLliI0fiflO&1";
    let width = |font: &str| -> f64 {
        ctx.set_font(font);
        ctx.measure_text(sample).map(|m| m.width()).unwrap_or(0.0)
    };
    let base: Vec<f64> = BASES.iter().map(|b| width(&format!("72px {b}"))).collect();
    FONTS.iter().map(|f| {
        let found = BASES.iter().zip(&base).any(|(b, w)| (width(&format!("72px '{f}',{b}")) - w).abs() > 0.01);
        if found { '1' } else { '0' }
    }).collect()
}

fn math_signals() -> String {
    format!("{:?}|{:?}|{:?}|{:?}|{:?}", js_sys::Math::acos(0.123456789), js_sys::Math::sinh(1.1), js_sys::Math::tan(-1e300),
        js_sys::Math::expm1(1.0), js_sys::Math::cbrt(100.0))
}

fn compute_browser_id() -> Result<String, JsValue> {
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
    let canvas_data = canvas.to_data_url()?;
    let navigator = window.navigator();
    let options = js_sys::Intl::DateTimeFormat::new(&js_sys::Array::new(), &js_sys::Object::new()).resolved_options();
    let zone = js_sys::Reflect::get(&options, &JsValue::from_str("timeZone"))?.as_string().unwrap_or_default();
    // Only signals that stay the same for a given device. Screen size and media-query preferences are left out on
    // purpose: an external monitor, rotation or an accessibility setting would silently change the ID.
    let signals = serde_json::json!([
        device_seed(&window), canvas_data, webgl_signals(&document), font_signals(&ctx), math_signals(),
        navigator.language(), String::from(navigator.languages().join(",")), navigator.platform()?,
        js_sys::Reflect::get(&navigator, &JsValue::from_str("vendor"))?.as_string().unwrap_or_default(),
        navigator.hardware_concurrency() as u32, navigator.max_touch_points(), window.screen()?.color_depth()?, zone
    ]).to_string();
    Ok(format!("{:x}", md5::compute(signals)))
}

// Computed once per page: WebGL contexts are limited and the canvas work is wasted on later requests.
fn browser_id() -> Result<String, JsValue> {
    if let Some(id) = BROWSER_ID.with(|cell| cell.borrow().clone()) { return Ok(id); }
    let id = compute_browser_id()?;
    BROWSER_ID.with(|cell| *cell.borrow_mut() = Some(id.clone()));
    Ok(id)
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
    let storage = window.local_storage().ok().flatten();
    let session = storage.as_ref().and_then(|s| s.get_item(SESSION_KEY).ok().flatten())
        .filter(|t| t.len() == 64 && t.bytes().all(|b| b.is_ascii_hexdigit()));
    let with_session = |builder: reqwest::RequestBuilder| match &session {
        Some(token) => builder.header("X-Cargo-Session", token),
        None => builder,
    };
    let request = if body.is_undefined() {
        with_session(client.get(&url))
    } else {
        let json = js_sys::JSON::stringify(&body)?.as_string()
            .ok_or_else(|| js_sys::Error::new("Invalid request body"))?;
        let parsed: serde_json::Value = serde_json::from_str(&json)
            .map_err(|_| js_sys::Error::new("Invalid request body"))?;
        let payload = serde_json::json!({ "time": js_sys::Date::now(), "body": parsed }).to_string();
        let encrypted = encrypt_payload(&endpoint, &payload)
            .map_err(|error| js_sys::Error::new(&error.as_string().unwrap_or_else(|| "Encryption failed".into())))?;
        with_session(client.post(&url).header("Content-Type", "application/octet-stream").body(encrypted))
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
    // The server hands out a new session token on login/registration. Keep it in localStorage, never expose it to the page.
    if let (Some(store), Some(token)) = (&storage, js_sys::Reflect::get(&result, &JsValue::from_str("session")).ok().and_then(|v| v.as_string())) {
        if token.len() == 64 { let _ = store.set_item(SESSION_KEY, &token); }
        let _ = js_sys::Reflect::delete_property(result.unchecked_ref::<js_sys::Object>(), &JsValue::from_str("session"));
    }
    if !success {
        let message = js_sys::Reflect::get(&result, &JsValue::from_str("error"))?.as_string()
            .unwrap_or_else(|| "Không thể gửi dữ liệu.".into());
        return Err(js_sys::Error::new(&message).into());
    }
    Ok(result)
}
