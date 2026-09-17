// Placeholder module, overwritten by quicktype-generated output during the
// fixture run. It exists only so `setup` can compile the project's
// dependencies ahead of time; that keeps each per-sample `gleam build` light
// enough to avoid the gleam compiler crashing under parallel dependency
// compilation.

import gleam/dynamic/decode
import gleam/json

pub type TopLevel {
  TopLevel
}

pub fn top_level_decoder() -> decode.Decoder(TopLevel) {
  decode.success(TopLevel)
}

pub fn top_level_to_json(_value: TopLevel) -> json.Json {
  json.null()
}
