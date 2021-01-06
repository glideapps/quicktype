# https://discourse.julialang.org/t/encapsulating-enum-access-via-dot-syntax/11785/10
macro option(T, args...)
    blk = esc(:(
        module $(Symbol("$(T)Module"))
            using JSON3
            export $T
            struct $T
                value::Int64
            end
            const NAME2VALUE = $(Dict(String(x.args[1])=>Int64(x.args[2]) for x in args))
            $T(str::String) = $T(NAME2VALUE[str])
            const VALUE2NAME = $(Dict(Int64(x.args[2])=>String(x.args[1]) for x in args))
            Base.string(e::$T) = VALUE2NAME[e.value]
            Base.getproperty(::Type{$T}, sym::Symbol) = haskey(NAME2VALUE, String(sym)) ? $T(String(sym)) : getfield($T, sym)
            Base.show(io::IO, e::$T) = print(io, string($T, ".", string(e), " = ", e.value))
            Base.propertynames(::Type{$T}) = $([x.args[1] for x in args])
            JSON3.StructType(::Type{$T}) = JSON3.StructTypes.StringType()

            function _itr(res)
                isnothing(res) && return res
                value, state = res
                return ($T(value), state)
            end
            Base.iterate(::Type{$T}) = _itr(iterate(keys(VALUE2NAME)))
            Base.iterate(::Type{$T}, state) = _itr(iterate(keys(VALUE2NAME), state))
        end
    ))
    top = Expr(:toplevel, blk)
    push!(top.args, :(using .$(Symbol("$(T)Module"))))
    return top
end
