#!/usr/bin/env ruby

module QuickType
    require 'json'
    require './TopLevel.rb'

    json = File.read(ARGV[0])
    top = TopLevel.from_json! json

    puts top.to_json
end