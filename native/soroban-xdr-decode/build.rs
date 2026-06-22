// build.rs — required by napi-build to emit the correct linker flags
// so that the resulting .node file links against the Node.js N-API ABI.
fn main() {
    napi_build::setup();
}
