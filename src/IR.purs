module IR where

import Prelude
import Data.List (List())
import Data.Set (Set)
import Data.Map (Map)

type IRClassData = { name :: String, properties :: Map String IRType }

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
    eq (IRClass { name: na, properties: pa }) (IRClass { name: nb, properties: pb }) = na == nb && pa == pb
    eq (IRUnion a) (IRUnion b) = a == b
    eq _ _ = false

instance ordIRType :: Ord IRType where
    compare IRNothing IRNothing = EQ
    compare IRNothing _ = LT
    compare _ IRNothing = GT
    compare IRNull IRNull = EQ
    compare IRNull _ = LT
    compare _ IRNull = GT
    compare IRInteger IRInteger = EQ
    compare IRInteger _ = LT
    compare _ IRInteger = GT
    compare IRDouble IRDouble = EQ
    compare IRDouble _ = LT
    compare _ IRDouble = GT
    compare IRBool IRBool = EQ
    compare IRBool _ = LT
    compare _ IRBool = GT
    compare IRString IRString = EQ
    compare IRString _ = LT
    compare _ IRString = GT
    compare (IRArray a) (IRArray b) = compare a b
    compare (IRArray _) _ = LT
    compare _ (IRArray _) = GT
    compare (IRClass { name: na, properties: pa }) (IRClass { name: nb, properties: pb }) =
        case compare na nb of
        EQ -> compare pa pb
        x -> x
    compare (IRClass _) _ = LT
    compare _ (IRClass _) = GT
    compare (IRUnion a) (IRUnion b) = compare a b
