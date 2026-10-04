;; -128 is the WASM32 address 0xffffff80, outside this one-page memory.
;; The sentinel at the end must not be read using Buffer's negative offsets.
(module
  (import "env" "memory" (memory 1 1))
  (func (export "alloc") (param i32) (result i32)
    i32.const 4096)
  (func (export "translate") (param i32 i32) (result i32)
    i32.const -128)
  (func (export "get_output_len") (result i32)
    i32.const 54)
  (data (i32.const 65408)
    "{\"description\":\"tail sentinel\",\"eventType\":\"boundary\"}"))
