using JSON3
include("enums.jl")
include("quicktype.jl")

JSON3.write(stdout, JSON3.read(read(ARGS[1], String), TopLevel))
