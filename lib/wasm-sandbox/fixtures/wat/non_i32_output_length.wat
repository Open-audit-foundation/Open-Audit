;; A valid module with a malformed output-length ABI: f64 instead of i32.
;; Integer coercion would turn 2^32 + 39 into the 39-byte JSON sentinel size.
(module
  (import "env" "memory" (memory 1 1))
  (func (export "alloc") (param i32) (result i32)
    i32.const 1024)
  (func (export "translate") (param i32 i32) (result i32)
    i32.const 2048)
  (func (export "get_output_len") (result f64)
    f64.const 4294967335)
  (data (i32.const 2048)
    "{\"description\":\"ok\",\"eventType\":\"test\"}"))
