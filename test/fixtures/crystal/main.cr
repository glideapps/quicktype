require "json"
require "./TopLevel"

json = File.read(ARGV[0].not_nil!)
top = TopLevel.from_json(json)

puts top.to_json
