//
//  main.swift
//  quicktype
//
//  Created by Mark Probst on 8/24/17.
//  Copyright © 2017 quicktype. All rights reserved.
//

import Foundation

let filename = CommandLine.arguments[1]
guard let data = FileHandle(forReadingAtPath: filename)?.readDataToEndOfFile()
else {
    print("Error: Could not read input file")
    exit(1)
}

guard let obj = TopLevel.from(data: data)
else {
    print("Error: Could not deserialize")
    exit(1)
}

guard let newData = obj.jsonData
else {
    print("Error: Could not serialize")
    exit(1)
}

guard let jsonString = String(data: newData, encoding: String.Encoding.utf8)
else {
    print("Error: Could not stringify")
    exit(1)
}

print(jsonString)
