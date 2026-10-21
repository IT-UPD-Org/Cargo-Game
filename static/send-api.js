let encryptionReady;
export const sendApi = async (endpoint, body) => {
  encryptionReady ??= import('./wasm/encrypt_modunel.js').then(async module => {
    await module.default();
    return module;
  });
  const wasm = await encryptionReady;
  return wasm.sendApi(endpoint, body);
};
