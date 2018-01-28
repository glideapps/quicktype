import Foundation

let filename = CommandLine.arguments[1]

guard let data = FileHandle(forReadingAtPath: filename)?.readDataToEndOfFile() else {
    print("Error: Could not read input file")
    exit(1)
}

let obj = try TopLevel(data: data)

guard let jsonString = try obj.jsonString() else {
    print("Error: Could not serialize")
    exit(1)
}

print(jsonString)

