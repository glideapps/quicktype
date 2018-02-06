mod module_under_test;

extern crate serde;

#[macro_use]
extern crate serde_derive;

extern crate serde_json;

use module_under_test::TopLevel;
use std::env;
use std::fs::File;
use std::io::prelude::*;

fn main() {

    let args: Vec<String> = env::args().collect();
    let filename = &args[1];
    
    let mut f = File::open(filename).expect("Input file not found");

    let mut json = String::new();
        f.read_to_string(&mut json)
            .expect("Input file cannot be read.");

    let top_level: TopLevel = serde_json::from_str(&json).unwrap();

    let result = serde_json::to_string(&top_level).unwrap();

    println!("{}", &result);
}
