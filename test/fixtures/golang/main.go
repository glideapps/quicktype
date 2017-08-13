package main

import "io/ioutil"
import "log"
import "os"

func main() {
	bytes, err := ioutil.ReadAll(os.Stdin)
	if err != nil {
		log.Fatal(err)
	}

	t, err := UnmarshalTopLevel(bytes)
	if err != nil {
		log.Fatal(err)
	}

	bytes, err = t.Marshal()
	if err != nil {
		log.Fatal(err)
	}

	n, err := os.Stdout.Write(bytes)
	if err != nil {
		log.Fatal(err)
	}
	if n != len(bytes) {
		log.Fatal("Could not write output")
	}
	os.Stdout.Write([]byte("\n"))
}
