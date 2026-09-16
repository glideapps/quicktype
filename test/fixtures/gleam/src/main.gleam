// Round-trip driver for the quicktype Gleam fixture tests.
//
// Reads a JSON file path from argv, decodes it into `TopLevel` with the
// generated decoder, re-encodes it, and prints the result to stdout. A decode
// failure exits non-zero — that exit code is the whole assertion for
// expected-failure (`*.fail.json`) samples.

import argv
import gleam/io
import gleam/json
import quicktype
import simplifile

pub fn main() {
  case argv.load().arguments {
    [path, ..] -> run(path)
    _ -> {
      io.println_error("usage: main <json-file>")
      halt(2)
    }
  }
}

fn run(path: String) -> a {
  let assert Ok(content) = simplifile.read(path)
  case json.parse(content, quicktype.top_level_decoder()) {
    Ok(value) -> {
      io.println(json.to_string(quicktype.top_level_to_json(value)))
      halt(0)
    }
    Error(_) -> halt(1)
  }
}

@external(erlang, "erlang", "halt")
fn halt(code: Int) -> a
