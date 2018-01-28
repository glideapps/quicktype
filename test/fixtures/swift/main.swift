//
//  main.swift
//  quicktype
//
//  Created by Mark Probst on 8/24/17.
//  Copyright © 2017 quicktype. All rights reserved.
//

import Foundation

let filename = CommandLine.arguments[1]

guard let data = FileHandle(forReadingAtPath: filename)?.readDataToEndOfFile() else {
    print("Error: Could not read input file")
    exit(1)
}

guard let obj = try TopLevel(data: data) else {
    print("Error: Could not deserialize")
    exit(1)
}

guard let jsonString = try obj.jsonString() else {
    print("Error: Could not serialize")
    exit(1)
}

print(jsonString)
