include "XDRScVal.dfy"
include "XDRDecoding.dfy"

module XDRProofs {
  import opened XDRScVal
  import opened XDRDecoding

  // ============================================================
  // THEOREM GROUP 1: Integer Overflow Safety
  // ============================================================

  lemma LemmaBytes4To32Range(buf: seq<bv8>)
    requires |buf| >= 4
    ensures 0 <= Bytes4To32(buf) <= MaxU32()
  {
    var b0 := Bv8ToInt(buf[0]);
    var b1 := Bv8ToInt(buf[1]);
    var b2 := Bv8ToInt(buf[2]);
    var b3 := Bv8ToInt(buf[3]);
    assert 0 <= b0 <= 255;
    assert 0 <= b1 <= 255;
    assert 0 <= b2 <= 255;
    assert 0 <= b3 <= 255;
  }

  lemma LemmaBytes8To64Range(buf: seq<bv8>)
    requires |buf| >= 8
    ensures 0 <= Bytes8To64(buf) <= MaxU64()
  {
    var b0 := Bv8ToInt(buf[0]);
    var b1 := Bv8ToInt(buf[1]);
    var b2 := Bv8ToInt(buf[2]);
    var b3 := Bv8ToInt(buf[3]);
    var b4 := Bv8ToInt(buf[4]);
    var b5 := Bv8ToInt(buf[5]);
    var b6 := Bv8ToInt(buf[6]);
    var b7 := Bv8ToInt(buf[7]);
    assert 0 <= b0 <= 255;
    assert 0 <= b1 <= 255;
    assert 0 <= b2 <= 255;
    assert 0 <= b3 <= 255;
    assert 0 <= b4 <= 255;
    assert 0 <= b5 <= 255;
    assert 0 <= b6 <= 255;
    assert 0 <= b7 <= 255;
  }

  lemma LemmaU32DecodedRange(buf: seq<bv8>)
    requires |buf| >= 4
    ensures DecodeU32FromSlice(buf).DecodeSuccess?
    ensures IsValidU32(DecodeU32FromSlice(buf).value)
  {
    LemmaBytes4To32Range(buf);
  }

  lemma LemmaI32DecodedRange(buf: seq<bv8>)
    requires |buf| >= 4
    ensures DecodeI32FromSlice(buf).DecodeSuccess?
    ensures IsValidI32(DecodeI32FromSlice(buf).value)
  {
    LemmaBytes4To32Range(buf);
    var raw := Bytes4To32(buf);
    if raw >= 0x80000000 {
      assert 0x80000000 <= raw <= MaxU32();
    } else {
      assert 0 <= raw <= 0x7FFFFFFF;
    }
  }

  lemma LemmaU64DecodedRange(buf: seq<bv8>)
    requires |buf| >= 8
    ensures DecodeU64FromSlice(buf).DecodeSuccess?
    ensures IsValidU64(DecodeU64FromSlice(buf).value)
  {
    LemmaBytes8To64Range(buf);
  }

  lemma LemmaI64DecodedRange(buf: seq<bv8>)
    requires |buf| >= 8
    ensures DecodeI64FromSlice(buf).DecodeSuccess?
    ensures IsValidI64(DecodeI64FromSlice(buf).value)
  {
    LemmaBytes8To64Range(buf);
    var raw := Bytes8To64(buf);
    if raw >= 0x8000000000000000 {
      assert 0x8000000000000000 <= raw <= MaxU64();
    } else {
      assert 0 <= raw <= MaxI64();
    }
  }

  lemma LemmaU128PairDecodedRange(hiBuf: seq<bv8>, loBuf: seq<bv8>)
    requires |hiBuf| >= 8
    requires |loBuf| >= 8
    ensures IsValidU128Pair(DecodeU64FromSlice(hiBuf).value, DecodeU64FromSlice(loBuf).value)
  {
    LemmaU64DecodedRange(hiBuf);
    LemmaU64DecodedRange(loBuf);
  }

  lemma LemmaI128PairDecodedRange(hiBuf: seq<bv8>, loBuf: seq<bv8>)
    requires |hiBuf| >= 8
    requires |loBuf| >= 8
    ensures IsValidI128Pair(DecodeI64FromSlice(hiBuf).value, DecodeU64FromSlice(loBuf).value)
  {
    LemmaI64DecodedRange(hiBuf);
    LemmaU64DecodedRange(loBuf);
  }

  lemma LemmaIntegerScValBoundsOnSuccess(buf: seq<bv8>, maxDepth: nat)
    requires |buf| >= 4
    requires DecodeScValFromSlice(buf, maxDepth).DecodeSuccess?
    ensures var r := DecodeScValFromSlice(buf, maxDepth);
            var s := r.value;
            match s {
              case scvU32(v) => IsValidU32(v)
              case scvI32(v) => IsValidI32(v)
              case scvU64(v) => IsValidU64(v)
              case scvI64(v) => IsValidI64(v)
              case scvU128(hi, lo) => IsValidU128Pair(hi, lo)
              case scvI128(hi, lo) => IsValidI128Pair(hi, lo)
              case _ => true
            }
  {
    var r := DecodeScValFromSlice(buf, maxDepth);
    var s := r.value;
    var rest := if |buf| >= 4 then buf[4..] else buf;
    match s {
      case scvU32(v) =>
        LemmaU32DecodedRange(rest);
      case scvI32(v) =>
        LemmaI32DecodedRange(rest);
      case scvU64(v) =>
        LemmaU64DecodedRange(rest);
      case scvI64(v) =>
        LemmaI64DecodedRange(rest);
      case scvU128(hi, lo) =>
        if |rest| >= 8 {
          var r1 := rest[8..];
          LemmaU64DecodedRange(rest);
          if |r1| >= 8 {
            LemmaU64DecodedRange(r1);
          }
        }
      case scvI128(hi, lo) =>
        if |rest| >= 8 {
          var r1 := rest[8..];
          LemmaI64DecodedRange(rest);
          if |r1| >= 8 {
            LemmaU64DecodedRange(r1);
          }
        }
      case _ =>
    }
  }

  // ============================================================
  // THEOREM GROUP 2: Zero-Length Array Safety
  // ============================================================

  lemma LemmaZeroLengthBytesDecodeSucceeds(buf: seq<bv8>)
    requires |buf| >= 4
    requires Bytes4To32(buf) == 0
    ensures var r := DecodeBytesFromSlice(buf);
            r.DecodeSuccess? && |r.value| == 0
  {
    LemmaBytes4To32Range(buf);
    PadLenOfZeroIsZero();
  }

  lemma LemmaZeroLengthVecDecodeSucceeds(buf: seq<bv8>, maxDepth: nat)
    requires |buf| >= 4
    requires maxDepth >= 0
    requires Bytes4To32(buf) == 0
    ensures var r := DecodeVecFromSlice(buf, maxDepth);
            r.DecodeSuccess? && |r.value| == 0
  {
    assert DecodeNElements(buf[4..], 0, maxDepth) == DecodeSuccess([], buf[4..]);
  }

  lemma LemmaZeroLengthMapDecodeSucceeds(buf: seq<bv8>, maxDepth: nat)
    requires |buf| >= 4
    requires maxDepth >= 0
    requires Bytes4To32(buf) == 0
    ensures var r := DecodeMapFromSlice(buf, maxDepth);
            r.DecodeSuccess? && |r.value| == 0
  {
    assert DecodeNEntries(buf[4..], 0, maxDepth) == DecodeSuccess([], buf[4..]);
  }

  lemma LemmaZeroLengthScValVecSucceeds(buf: seq<bv8>, maxDepth: nat)
    requires |buf| >= 8
    requires maxDepth >= 1
    requires Bytes4To32(buf) == 11
    requires Bytes4To32(buf[4..]) == 0
    ensures DecodeScValFromSlice(buf, maxDepth) == DecodeSuccess(scvVec([]), buf[8..])
  {
    LemmaBytes4To32Range(buf);
    LemmaBytes4To32Range(buf[4..]);
    LemmaZeroLengthVecDecodeSucceeds(buf[4..], maxDepth - 1);
  }

  lemma LemmaZeroLengthScValMapSucceeds(buf: seq<bv8>, maxDepth: nat)
    requires |buf| >= 8
    requires maxDepth >= 1
    requires Bytes4To32(buf) == 12
    requires Bytes4To32(buf[4..]) == 0
    ensures DecodeScValFromSlice(buf, maxDepth) == DecodeSuccess(scvMap([]), buf[8..])
  {
    LemmaBytes4To32Range(buf);
    LemmaBytes4To32Range(buf[4..]);
    LemmaZeroLengthMapDecodeSucceeds(buf[4..], maxDepth - 1);
  }

  lemma LemmaZeroLengthScValBytesSucceeds(buf: seq<bv8>, maxDepth: nat)
    requires |buf| >= 8
    requires Bytes4To32(buf) == 8
    requires Bytes4To32(buf[4..]) == 0
    ensures DecodeScValFromSlice(buf, maxDepth) == DecodeSuccess(scvBytes([]), buf[8..])
  {
    LemmaBytes4To32Range(buf);
    LemmaBytes4To32Range(buf[4..]);
    PadLenOfZeroIsZero();
    LemmaZeroLengthBytesDecodeSucceeds(buf[4..]);
  }

  // ============================================================
  // THEOREM GROUP 3: Recursive Depth Limit Safety
  // ============================================================

  lemma LemmaMaxDepthZeroRejectsVecAndMap(buf: seq<bv8>)
    requires |buf| >= 4
    ensures var disc := Bytes4To32(buf);
            var r := DecodeScValFromSlice(buf, 0);
            (disc == 11 || disc == 12) ==> !r.DecodeSuccess?
  {
    var disc := Bytes4To32(buf);
    if disc == 11 || disc == 12 {
      assert DecodeScValFromSlice(buf, 0) == DecodeError;
    }
  }

  lemma LemmaMaxDepthZeroOnlyLeaves(buf: seq<bv8>)
    requires |buf| >= 4
    ensures var r := DecodeScValFromSlice(buf, 0);
            r.DecodeSuccess? ==> IsValidLeaf(r.value)
  {
    var r := DecodeScValFromSlice(buf, 0);
    if r.DecodeSuccess? {
      var disc := Bytes4To32(buf);
      assert disc != 11 && disc != 12;
      var s := r.value;
      match s {
        case scvVec(_) =>
          assert false;
        case scvMap(_) =>
          assert false;
        case _ =>
      }
    }
  }

  lemma LemmaScValDepthBoundedByMaxDepth(buf: seq<bv8>, maxDepth: nat)
    requires maxDepth >= 0
    ensures var r := DecodeScValFromSlice(buf, maxDepth);
            r.DecodeSuccess? ==> DepthOfScVal(r.value) <= maxDepth
  {
    // The function DecodeScValFromSlice already has an ensures clause
    // proving this property. No additional proof needed.
  }

  lemma LemmaDecodeRecursiveRequiresPositiveDepth(buf: seq<bv8>, maxDepth: nat)
    requires |buf| >= 8
    requires Bytes4To32(buf) == 11 || Bytes4To32(buf) == 12
    ensures DecodeScValFromSlice(buf, 0) == DecodeError
    ensures maxDepth > 0 ==> (
      var r := DecodeScValFromSlice(buf, maxDepth);
      r.DecodeSuccess? ==>
        match r.value {
          case scvVec(_) => true
          case scvMap(_) => true
          case _ => false
        }
    )
  {
    var disc := Bytes4To32(buf);
    if disc == 11 || disc == 12 {
      assert DecodeScValFromSlice(buf, 0) == DecodeError;
    }
  }

  // ============================================================
  // INTEGRATION THEOREMS: All safety properties combined
  // ============================================================

  lemma LemmaCombinedXDRSafety(buf: seq<bv8>, maxDepth: nat)
    requires |buf| >= 4
    requires maxDepth >= 0
    requires DecodeScValFromSlice(buf, maxDepth).DecodeSuccess?
    ensures var r := DecodeScValFromSlice(buf, maxDepth);
            var s := r.value;
            (match s {
              case scvU32(v) => IsValidU32(v)
              case scvI32(v) => IsValidI32(v)
              case scvU64(v) => IsValidU64(v)
              case scvI64(v) => IsValidI64(v)
              case scvU128(hi, lo) => IsValidU128Pair(hi, lo)
              case scvI128(hi, lo) => IsValidI128Pair(hi, lo)
              case _ => true
            })
            &&
            DepthOfScVal(s) <= maxDepth
  {
    LemmaIntegerScValBoundsOnSuccess(buf, maxDepth);
    LemmaScValDepthBoundedByMaxDepth(buf, maxDepth);
  }
}
