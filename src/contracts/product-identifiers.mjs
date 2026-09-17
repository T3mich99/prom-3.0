export function stripOuterU(value) {
  return String(value ?? '').replace(/^U/iu, '').replace(/U$/iu, '');
}
