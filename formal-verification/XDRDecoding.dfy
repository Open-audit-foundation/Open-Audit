include "XDRScVal.dfy"

module XDRDecoding {
  import opened XDRScVal

  datatype DecodeResult<T> = DecodeError | DecodeSuccess(value: T, rest: seq<bv8>)

  predicate IsDecodeSuccess<T>(r: DecodeResult<T>) {
    r.DecodeSuccess?
  }

  function GetDecodeValue<T>(r: DecodeResult<T>): T
    requires r.DecodeSuccess?
  {
    r.value
  }

  function GetDecodeRest<T>(r: DecodeResult<T>): seq<bv8>
    requires r.DecodeSuccess?
  {
    r.rest
  }

  function MaxU32(): int { 0xFFFFFFFF }
  function MinI32(): int { -0x80000000 }
  function MaxI32(): int { 0x7FFFFFFF }
  function MaxU64(): int { 0xFFFFFFFFFFFFFFFF }
  function MinI64(): int { -0x8000000000000000 }
  function MaxI64(): int { 0x7FFFFFFFFFFFFFFF }

  function Bv8ToChar(b: bv8): char {
    b as char
  }

  function BytesToString(b: seq<bv8>): string
    ensures |BytesToString(b)| == |b|
  {
    seq(|b|, i requires 0 <= i < |b| => Bv8ToChar(b[i]))
  }

  function Bytes8To64(buf: seq<bv8>): (res: int)
    requires |buf| >= 8
    ensures 0 <= res <= MaxU64()
  {
    var b0 := Bv8ToInt(buf[0]);
    var b1 := Bv8ToInt(buf[1]);
    var b2 := Bv8ToInt(buf[2]);
    var b3 := Bv8ToInt(buf[3]);
    var b4 := Bv8ToInt(buf[4]);
    var b5 := Bv8ToInt(buf[5]);
    var b6 := Bv8ToInt(buf[6]);
    var b7 := Bv8ToInt(buf[7]);
    b0 * 0x100000000000000 +
    b1 * 0x1000000000000 +
    b2 * 0x10000000000 +
    b3 * 0x100000000 +
    b4 * 0x1000000 +
    b5 * 0x10000 +
    b6 * 0x100 +
    b7
  }

  function Bytes4To32(buf: seq<bv8>): (res: int)
    requires |buf| >= 4
    ensures 0 <= res <= MaxU32()
  {
    var b0 := Bv8ToInt(buf[0]);
    var b1 := Bv8ToInt(buf[1]);
    var b2 := Bv8ToInt(buf[2]);
    var b3 := Bv8ToInt(buf[3]);
    b0 * 0x1000000 + b1 * 0x10000 + b2 * 0x100 + b3
  }

  function PadLen(len: int): (res: int)
    requires 0 <= len
    ensures 0 <= res < 4
  {
    (4 - len % 4) % 4
  }

  lemma PadLenOfZeroIsZero()
    ensures PadLen(0) == 0
  {
    assert 0 % 4 == 0;
  }

  function DecodeU32FromSlice(buf: seq<bv8>): DecodeResult<int>
    decreases |buf|
  {
    if |buf| < 4 then DecodeError
    else
      var val := Bytes4To32(buf);
      DecodeSuccess(val, buf[4..])
  }

  function DecodeI32FromSlice(buf: seq<bv8>): DecodeResult<int>
    decreases |buf|
  {
    if |buf| < 4 then DecodeError
    else
      var raw := Bytes4To32(buf);
      var val := if raw >= 0x80000000 then raw - 0x100000000 else raw;
      DecodeSuccess(val, buf[4..])
  }

  function DecodeU64FromSlice(buf: seq<bv8>): DecodeResult<int>
    decreases |buf|
  {
    if |buf| < 8 then DecodeError
    else
      var val := Bytes8To64(buf);
      DecodeSuccess(val, buf[8..])
  }

  function DecodeI64FromSlice(buf: seq<bv8>): DecodeResult<int>
    decreases |buf|
  {
    if |buf| < 8 then DecodeError
    else
      var raw := Bytes8To64(buf);
      var val := if raw >= 0x8000000000000000 then raw - 0x10000000000000000 else raw;
      DecodeSuccess(val, buf[8..])
  }

  function DecodeBytesFromSlice(buf: seq<bv8>): DecodeResult<seq<bv8>>
    decreases |buf|
  {
    if |buf| < 4 then DecodeError
    else
      var len := Bytes4To32(buf);
      if |buf| < 4 + len + PadLen(len) then DecodeError
      else
        var data := buf[4..4+len];
        DecodeSuccess(data, buf[4+len+PadLen(len)..])
  }

  function DecodeScValType0Bool(buf: seq<bv8>): DecodeResult<ScVal>
    requires |buf| >= 4
    decreases |buf|
  {
    if |buf| < 4 then DecodeError
    else
      var raw := Bytes4To32(buf);
      DecodeSuccess(scvBool(raw != 0), buf[4..])
  }

  function DecodeScValFromSlice(buf: seq<bv8>, maxDepth: nat): (res: DecodeResult<ScVal>)
    decreases maxDepth, |buf|, 0
    ensures res.DecodeSuccess? ==> DepthOfScVal(res.value) <= maxDepth
    ensures res.DecodeSuccess? ==> |res.rest| <= |buf|
  {
    if |buf| < 4 then DecodeError
    else
      var disc := Bytes4To32(buf);
      var rest := buf[4..];
      if disc == 0 then
        if |rest| < 4 then DecodeError
        else DecodeScValType0Bool(rest)
      else if disc == 1 then
        DecodeSuccess(scvVoid, rest)
      else if disc == 2 then
        match DecodeU32FromSlice(rest) {
          case DecodeError => DecodeError
          case DecodeSuccess(v, r) => DecodeSuccess(scvU32(v), r)
        }
      else if disc == 3 then
        match DecodeI32FromSlice(rest) {
          case DecodeError => DecodeError
          case DecodeSuccess(v, r) => DecodeSuccess(scvI32(v), r)
        }
      else if disc == 4 then
        match DecodeU64FromSlice(rest) {
          case DecodeError => DecodeError
          case DecodeSuccess(v, r) => DecodeSuccess(scvU64(v), r)
        }
      else if disc == 5 then
        match DecodeI64FromSlice(rest) {
          case DecodeError => DecodeError
          case DecodeSuccess(v, r) => DecodeSuccess(scvI64(v), r)
        }
      else if disc == 6 then
        match DecodeU64FromSlice(rest) {
          case DecodeError => DecodeError
          case DecodeSuccess(hi, r1) =>
            match DecodeU64FromSlice(r1) {
              case DecodeError => DecodeError
              case DecodeSuccess(lo, r2) => DecodeSuccess(scvU128(hi, lo), r2)
            }
        }
      else if disc == 7 then
        match DecodeI64FromSlice(rest) {
          case DecodeError => DecodeError
          case DecodeSuccess(hi, r1) =>
            match DecodeU64FromSlice(r1) {
              case DecodeError => DecodeError
              case DecodeSuccess(lo, r2) => DecodeSuccess(scvI128(hi, lo), r2)
            }
        }
      else if disc == 8 then
        match DecodeBytesFromSlice(rest) {
          case DecodeError => DecodeError
          case DecodeSuccess(d, r) => DecodeSuccess(scvBytes(d), r)
        }
      else if disc == 9 then
        match DecodeBytesFromSlice(rest) {
          case DecodeError => DecodeError
          case DecodeSuccess(d, r) => DecodeSuccess(scvString(BytesToString(d)), r)
        }
      else if disc == 10 then
        match DecodeBytesFromSlice(rest) {
          case DecodeError => DecodeError
          case DecodeSuccess(d, r) => DecodeSuccess(scvSymbol(BytesToString(d)), r)
        }
      else if disc == 11 then
        if maxDepth == 0 then DecodeError
        else
          match DecodeVecFromSlice(rest, maxDepth - 1) {
            case DecodeError => DecodeError
            case DecodeSuccess(v, r) => DecodeSuccess(scvVec(v), r)
          }
      else if disc == 12 then
        if maxDepth == 0 then DecodeError
        else
          match DecodeMapFromSlice(rest, maxDepth - 1) {
            case DecodeError => DecodeError
            case DecodeSuccess(m, r) =>
              DepthOfMapFromEntries(m, maxDepth - 1);
              DecodeSuccess(scvMap(m), r)
          }
      else if disc == 13 then
        match DecodeBytesFromSlice(rest) {
          case DecodeError => DecodeError
          case DecodeSuccess(d, r) => DecodeSuccess(scvAddress(d), r)
        }
      else
        DecodeError
  }

  function DecodeVecFromSlice(buf: seq<bv8>, maxDepth: nat): (res: DecodeResult<seq<ScVal>>)
    decreases maxDepth, |buf|, 0
    ensures res.DecodeSuccess? ==> forall elem :: elem in res.value ==> DepthOfScVal(elem) <= maxDepth
    ensures res.DecodeSuccess? ==> MaxDepthSeq(res.value) <= maxDepth
    ensures res.DecodeSuccess? ==> |res.rest| <= |buf|
  {
    if |buf| < 4 then DecodeError
    else
      var count := Bytes4To32(buf);
      var rest := buf[4..];
      DecodeNElements(rest, count, maxDepth)
  }

  function DecodeNElements(buf: seq<bv8>, count: int, maxDepth: nat): (res: DecodeResult<seq<ScVal>>)
    requires 0 <= count
    decreases maxDepth, |buf|, 1, count
    ensures res.DecodeSuccess? ==>
      (forall elem :: elem in res.value ==> DepthOfScVal(elem) <= maxDepth)
    ensures res.DecodeSuccess? ==> MaxDepthSeq(res.value) <= maxDepth
    ensures res.DecodeSuccess? ==> |res.rest| <= |buf|
  {
    if count == 0 then
      DecodeSuccess([], buf)
    else
      match DecodeScValFromSlice(buf, maxDepth) {
        case DecodeError => DecodeError
        case DecodeSuccess(elem, rest1) =>
          match DecodeNElements(rest1, count - 1, maxDepth) {
            case DecodeError => DecodeError
            case DecodeSuccess(elems, rest2) =>
              DecodeSuccess([elem] + elems, rest2)
          }
      }
  }

  function DecodeMapFromSlice(buf: seq<bv8>, maxDepth: nat): (res: DecodeResult<seq<(ScVal, ScVal)>>)
    decreases maxDepth, |buf|, 0
    ensures res.DecodeSuccess? ==> forall entry :: entry in res.value ==>
      DepthOfScVal(entry.0) <= maxDepth && DepthOfScVal(entry.1) <= maxDepth
    ensures res.DecodeSuccess? ==> MaxDepthEntries(res.value) <= maxDepth
    ensures res.DecodeSuccess? ==> |res.rest| <= |buf|
  {
    if |buf| < 4 then DecodeError
    else
      var count := Bytes4To32(buf);
      var rest := buf[4..];
      DecodeNEntries(rest, count, maxDepth)
  }

  function DecodeNEntries(buf: seq<bv8>, count: int, maxDepth: nat): (res: DecodeResult<seq<(ScVal, ScVal)>>)
    requires 0 <= count
    decreases maxDepth, |buf|, 2, count
    ensures res.DecodeSuccess? ==> forall entry :: entry in res.value ==>
      DepthOfScVal(entry.0) <= maxDepth && DepthOfScVal(entry.1) <= maxDepth
    ensures res.DecodeSuccess? ==> MaxDepthEntries(res.value) <= maxDepth
    ensures res.DecodeSuccess? ==> |res.rest| <= |buf|
  {
    if count == 0 then
      DecodeSuccess([], buf)
    else
      match DecodeScValFromSlice(buf, maxDepth) {
        case DecodeError => DecodeError
        case DecodeSuccess(key, rest1) =>
          match DecodeScValFromSlice(rest1, maxDepth) {
            case DecodeError => DecodeError
            case DecodeSuccess(val, rest2) =>
              match DecodeNEntries(rest2, count - 1, maxDepth) {
                case DecodeError => DecodeError
                case DecodeSuccess(entries, rest3) =>
                  DecodeSuccess([(key, val)] + entries, rest3)
              }
          }
      }
  }
}
