import Foundation

let filename = CommandLine.arguments[1]

guard let data = FileHandle(forReadingAtPath: filename)?.readDataToEndOfFile() else {
    print("Error: Could not read input file")
    exit(1)
}

do {
    let obj = try newJSONDecoder().decode(TopLevel.self, from: data)
    let jsonData = try newJSONEncoder().encode(obj)
    FileHandle.standardOutput.write(jsonData)
} catch {
    fputs("\(error)\n", stderr)
    exit(1)
}
