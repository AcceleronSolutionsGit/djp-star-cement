/** Stub for engines/pjp/data-loader.engine.js — only the readiness gate is used. */
export async function checkAllExcelInputsAvailable() {
  return { allAvailable: true, missing: [], missingKeys: [], available: [], required: [] };
}
