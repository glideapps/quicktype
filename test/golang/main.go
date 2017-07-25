package main

import "encoding/json"

import "io/ioutil"
import "log"
import "os"

func main() {
	bytes, err := ioutil.ReadAll(os.Stdin)
	if err != nil {
		log.Fatal(err)
	}

	var t Root

	err = json.Unmarshal(bytes, &t)
	if err != nil {
		log.Fatal(err)
	}

	bytes, err = json.Marshal(t)
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
