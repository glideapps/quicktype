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
    eq IRNothing IRNothing = true
    eq IRNull IRNull = true
    eq IRInteger IRInteger = true
    eq IRDouble IRDouble = true
    eq IRBool IRBool = true
    eq IRString IRString = true
    eq (IRArray a) (IRArray b) = a == b
    eq (IRClass a) (IRClass b) = a == b
    eq (IRUnion a) (IRUnion b) = a == b
    eq _ _ = false