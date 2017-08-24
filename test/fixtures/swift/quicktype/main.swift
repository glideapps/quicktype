//
//  main.swift
//  quicktype
//
//  Created by Mark Probst on 8/24/17.
//  Copyright © 2017 quicktype. All rights reserved.
//

import Foundation

let filename = CommandLine.arguments[1]
guard
    let data = FileHandle(forReadingAtPath: filename)?.readDataToEndOfFile(),
    let obj = topLevel(fromJSONData: data),
    let newData = jsonData(fromTopLevel: obj),
    let jsonString = String(data: newData, encoding: String.Encoding.utf8)
else {
    exit(1)
}

print(jsonString)
