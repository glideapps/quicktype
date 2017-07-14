module IR where

import Prelude
import Data.List (List())
import Data.Set (Set)

type IRProperty = { name :: String, typ :: IRType }
type IRClassData = { name :: String, properties :: Set IRProperty }

data IRType
    = IRNothing
    | IRNull
    | IRInteger
    | IRDouble
    | IRBool
    | IRString
    | IRArray IRType
    | IRClass IRClassData
    | IRUnion (Set IRType)

-- TODO finish later! Just a little equality will go a long way for now
instance eqIRType :: Eq IRType where
    eq IRString IRString = true
    eq IRDouble IRDouble = true
    eq _ _ = false