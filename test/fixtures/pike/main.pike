// This is a dummy test fixture for Pike
// It will be finished when JSON decoding will be finished.

int main (int argc, array(string) argv) {
  Stdio.File f = Stdio.File(argv[1], "r");
  //TopLevel from_json = decode_json_from_TopLevel(f.read());
  //string to_json = Standards.JSON.encode(from_json);
  write(f.read());

  return 0;
}