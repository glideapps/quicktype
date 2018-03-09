#!/usr/bin/env ruby

require 'json'
require './TopLevel.rb'

json = File.read(ARGV[0])
top = TopLevel.from_json! json

puts top.to_json
