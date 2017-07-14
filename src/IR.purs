module IR where

import Data.List (List())

type IRProperty = { name :: String, typ :: IRType }
type IRClassData = { name :: String, properties :: List IRProperty }

data IRType
    = IRNothing
    | IRNull
    | IRInteger
    | IRDouble
    | IRBool
    | IRString
    | IRArray IRType
    | IRClass IRClassData
    | IRUnion (Array IRType)