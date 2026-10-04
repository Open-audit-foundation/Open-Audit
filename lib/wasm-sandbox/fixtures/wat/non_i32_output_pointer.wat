;; A valid module with a malformed ABI: translate returns f64, not i32.
;; Unsigned bitwise coercion would wrap 2^32 + 1024 to the sentinel at 1024.
(module
  (import "env" "memory" (memory 1 1))
  (func (export "alloc") (param i32) (result i32)
    i32.const 4096)
  (func (export "translate") (param i32 i32) (result f64)
    f64.const 4294968320)
  (func (export "get_output_len") (result i32)
    i32.const 54)
  (data (i32.const 1024)
    "{\"description\":\"tail sentinel\",\"eventType\":\"boundary\"}"))
