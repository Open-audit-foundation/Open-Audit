module XDRScVal {
  datatype ScVal =
    | scvBool(bval: bool)
    | scvVoid
    | scvU32(u32Val: int)
    | scvI32(i32Val: int)
    | scvU64(u64Val: int)
    | scvI64(i64Val: int)
    | scvU128(u128Hi: int, u128Lo: int)
    | scvI128(i128Hi: int, i128Lo: int)
    | scvBytes(bdata: seq<bv8>)
    | scvString(sval: string)
    | scvSymbol(symVal: string)
    | scvVec(elements: seq<ScVal>)
    | scvMap(entries: seq<(ScVal, ScVal)>)
    | scvAddress(addrData: seq<bv8>)

  predicate IsValidU32(v: int) { 0 <= v < 0x100000000 }
  predicate IsValidI32(v: int) { -0x80000000 <= v < 0x80000000 }
  predicate IsValidU64(v: int) { 0 <= v < 0x10000000000000000 }
  predicate IsValidI64(v: int) { -0x8000000000000000 <= v < 0x8000000000000000 }
  predicate IsValidU128Pair(hi: int, lo: int) { IsValidU64(hi) && IsValidU64(lo) }
  predicate IsValidI128Pair(hi: int, lo: int) { IsValidI64(hi) && IsValidU64(lo) }

  predicate IsValidLeaf(s: ScVal) {
    match s {
      case scvVec(_) => false
      case scvMap(_) => false
      case _ => true
    }
  }

  function Bv8ToInt(b: bv8): int {
    b as int
  }

  function DepthOfScVal(s: ScVal): nat
    decreases s, 2, 0
  {
    match s {
      case scvVec(elems) =>
        if |elems| == 0 then 0 else 1 + MaxDepthSeq(elems)
      case scvMap(entries) =>
        if |entries| == 0 then 0 else 1 + MaxDepthEntriesHelper(s, 0)
      case _ => 0
    }
  }

  function MaxDepthSeq(s: seq<ScVal>): nat
    decreases s, 1, 0
  {
    if |s| == 0 then 0
    else Max(DepthOfScVal(s[0]), MaxDepthSeq(s[1..]))
  }

  function MaxDepthEntriesHelper(m: ScVal, i: nat): nat
    requires m.scvMap?
    decreases m, 1, |m.entries| - i
  {
    var entries := m.entries;
    if i >= |entries| then 0
    else
      var p := entries[i];
      Max(Max(DepthOfScVal(p.0), DepthOfScVal(p.1)), MaxDepthEntriesHelper(m, i + 1))
  }

  function MaxDepthEntries(e: seq<(ScVal, ScVal)>): nat {
    if |e| == 0 then 0
    else
      var p := e[0];
      Max(Max(DepthOfScVal(p.0), DepthOfScVal(p.1)), MaxDepthEntries(e[1..]))
  }

  function Max(a: nat, b: nat): nat {
    if a >= b then a else b
  }

  lemma HelperAndEntriesEq(m: ScVal, entries: seq<(ScVal, ScVal)>, i: nat)
    requires m.scvMap? && m.entries == entries
    requires i <= |entries|
    decreases |entries| - i
    ensures MaxDepthEntriesHelper(m, i) == MaxDepthEntries(entries[i..])
  {
    if i == |entries| {
      assert entries[i..] == [];
    } else {
      HelperAndEntriesEq(m, entries, i + 1);
    }
  }

  lemma DepthOfMapFromEntries(e: seq<(ScVal, ScVal)>, limit: nat)
    requires MaxDepthEntries(e) <= limit
    ensures DepthOfScVal(scvMap(e)) <= limit + 1
  {
    if |e| == 0 {
      assert DepthOfScVal(scvMap(e)) == 0;
    } else {
      HelperAndEntriesEq(scvMap(e), e, 0);
      assert MaxDepthEntriesHelper(scvMap(e), 0) == MaxDepthEntries(e);
    }
  }

  lemma MaxDepthSeqExtend(s: seq<ScVal>, x: ScVal)
    ensures MaxDepthSeq(s + [x]) == Max(MaxDepthSeq(s), DepthOfScVal(x))
  {
    if |s| == 0 {
      assert MaxDepthSeq([x]) == DepthOfScVal(x);
    } else {
      MaxDepthSeqExtend(s[1..], x);
      assert (s + [x])[0] == s[0];
      assert (s + [x])[1..] == s[1..] + [x];
      assert MaxDepthSeq(s) == Max(DepthOfScVal(s[0]), MaxDepthSeq(s[1..]));
    }
  }
}
