module Warmup exposing (warmup)

{-| Compiled once by the fixture's setup command so that all package
dependencies are downloaded and built into the shared ELM_HOME cache
before the per-sample compiles run in parallel. Concurrent cold-cache
builds corrupt elm's shared package cache (still reproducible with
elm 0.19.2).
-}

import Dict exposing (Dict)
import Json.Decode as Jdec
import Json.Decode.Pipeline as Jpipe
import Json.Encode as Jenc


warmup : Jdec.Decoder ( Dict String Int, Jenc.Value )
warmup =
    Jdec.succeed (\x -> ( Dict.empty, x ))
        |> Jpipe.required "x" Jdec.value
