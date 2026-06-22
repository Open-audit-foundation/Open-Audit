/**
 * Utility pipeline for Open-Audit blueprint creators to format 
 * raw blockchain data into human-readable strings.
 */

/**
 * Converts Stellar native token amounts from Stroops (7 decimal places) to XLM.
 * Uses string manipulation to avoid floating-point precision loss.
 */
export function formatStroopsToXLM(stroops: string | number | bigint): string {
  const stroopsStr = stroops.toString().trim();
  
  if (!stroopsStr || isNaN(Number(stroopsStr))) {
    return "0.0000000";
  }

  const isNegative = stroopsStr.startsWith('-');
  const absoluteStroops = isNegative ? stroopsStr.slice(1) : stroopsStr;

  const padded = absoluteStroops.padStart(8, '0');
  const xlmIndex = padded.length - 7;
  const xlmPart = padded.slice(0, xlmIndex);
  const stroopPart = padded.slice(xlmIndex);

  const formattedDecimals = stroopPart.replace(/0+$/, '');
  const decimalResult = formattedDecimals.length > 0 ? formattedDecimals : '0';

  return `${isNegative ? '-' : ''}${xlmPart}.${decimalResult}`;
}

/**
 * Truncates a Stellar public key or contract address to a highly readable format.
 * Example: GABC123456...7890WXYZ -> GABC...WXYZ
 */
export function truncateAddress(address: string, chars: number = 4): string {
  if (!address) return "";
  if (address.length <= chars * 2) return address;
  
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Formats a Unix timestamp into a readable date and time sentence structure.
 */
export function formatUnixEpoch(
  epoch: string | number, 
  locales: string = 'en-US'
): string {
  const parsedEpoch = typeof epoch === 'string' ? parseInt(epoch, 10) : epoch;

  if (!parsedEpoch || isNaN(parsedEpoch)) {
    return "Unknown Date";
  }

  const isSeconds = parsedEpoch < 40000000000; 
  const milliseconds = isSeconds ? parsedEpoch * 1000 : parsedEpoch;
  const date = new Date(milliseconds);

  return date.toLocaleString(locales, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });
}
