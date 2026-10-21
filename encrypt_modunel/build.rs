use std::{env, fs, path::PathBuf};
fn main() {
    println!("cargo:rerun-if-env-changed=CARGO_RESPONSE_KEY_FILE");
    let response_file = env::var("CARGO_RESPONSE_KEY_FILE").expect("Set CARGO_RESPONSE_KEY_FILE");
    println!("cargo:rerun-if-changed={response_file}");
    let response = fs::read(response_file).expect("Read response key");
    assert_eq!(response.len(), 32);
    let masked: Vec<u8> = response.iter().enumerate().map(|(i, b)| b ^ ((i * 37 + 93) as u8)).collect();
    fs::write(PathBuf::from(env::var("OUT_DIR").unwrap()).join("response.rs"), format!("static RESPONSE_MASKED: &[u8] = &{:?};", masked)).unwrap();
    println!("cargo:rerun-if-env-changed=CARGO_PUBLIC_KEY_FILE");
    let file = env::var("CARGO_PUBLIC_KEY_FILE").expect("Set CARGO_PUBLIC_KEY_FILE to the generated DER file");
    println!("cargo:rerun-if-changed={file}");
    let key = fs::read(file).expect("Read public key");
    let bytes: Vec<u8> = key.iter().enumerate().map(|(i, b)| b ^ ((i * 73 + 159) as u8)).collect();
    fs::write(PathBuf::from(env::var("OUT_DIR").unwrap()).join("key.rs"), format!("static MASKED: &[u8] = &{:?};", bytes)).unwrap();
}
