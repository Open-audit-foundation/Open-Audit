/** Shared Content-Security-Policy header value for custom HTTP servers. */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://* https://horizon-testnet.stellar.org https://soroban-testnet.stellar.org https://horizon.stellar.org https://mainnet.stellar.validationcloud.io; img-src 'self' data:; font-src 'self' data:;";

export function applyContentSecurityPolicy(res: { setHeader: (name: string, value: string) => void }): void {
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
}
