#!/usr/bin/env ruby

module QuickType
    require 'json'
    require './TopLevel.rb'

    json = File.read(ARGV[0])
    top = if TopLevel.respond_to?(:from_json!)
              TopLevel.from_json! json
          else
              Types::TopLevel[JSON.parse(json)]
          end

    puts top.to_json
end
