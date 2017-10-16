module Reykjavik
    ( GlueGraph
    , irGraphToGlue
    ) where

import Prelude

import Data.Argonaut.Core (Json, fromNumber, fromArray, fromObject, fromString, jsonNull)
import Data.Array as A
import Data.Int as Int
import Data.Map as M
import Data.Sequence as Seq
import Data.Set (Set)
import Data.Set as S
import Data.StrMap (StrMap)
import Data.StrMap as SM
import Doc (combineNames)
import IRGraph (Entry(..), IRClassData(..), IRGraph(..), IRType(..), IRUnionRep(..), Named, namedValue, unionToList)

type GlueGraph =
    { classes :: Array Json
    , toplevels :: StrMap Json
    }

typeJSObject :: String -> StrMap Json -> Json
typeJSObject kind =
    fromObject <<< SM.insert "kind" (fromString kind)

namedToJS :: Named (Set String) -> Json
namedToJS named =
    let combined = combineNames named
    in
        fromObject $
        SM.insert "names" (fromArray $ map fromString $ S.toUnfoldable $ namedValue named) $
        SM.insert "combined" (fromString combined) $
        SM.empty

typeToJS :: IRType -> Json
typeToJS IRNoInformation = jsonNull
typeToJS IRAnyType = typeJSObject "any" SM.empty
typeToJS IRNull = typeJSObject "null" SM.empty
typeToJS IRInteger = typeJSObject "integer" SM.empty
typeToJS IRDouble = typeJSObject "double" SM.empty
typeToJS IRBool = typeJSObject "bool" SM.empty
typeToJS IRString = typeJSObject "string" SM.empty
typeToJS (IRArray t) = typeJSObject "array" $
    SM.insert "items" (typeToJS t) $
    SM.empty
typeToJS (IRClass i) = typeJSObject "class" $
    SM.insert "index" (fromNumber $ Int.toNumber i) $
    SM.empty
typeToJS (IRMap t) = typeJSObject "map" $
    SM.insert "values" (typeToJS t) $
    SM.empty
typeToJS (IRUnion ur@(IRUnionRep { names })) = typeJSObject "union" $
    SM.insert "names" (namedToJS names) $
    SM.insert "members" (fromArray $ A.fromFoldable $ map typeToJS $ unionToList ur) $
    SM.empty

entryToJS :: Entry -> Json
entryToJS (Class (IRClassData { names, properties })) =
    let propertiesStrMap = SM.fromFoldable $ (M.toUnfoldable properties :: Array _)
    in
        typeJSObject "class" $
        SM.insert "names" (namedToJS names) $
        SM.insert "properties" (fromObject $ SM.mapWithKey (const typeToJS) propertiesStrMap) $
        SM.empty
entryToJS _ = jsonNull

irGraphToGlue :: IRGraph -> GlueGraph
irGraphToGlue (IRGraph { classes, toplevels }) =
    let toplevelsStrMap = SM.fromFoldable $ (M.toUnfoldable toplevels :: Array _)
    in
        { classes: map entryToJS $ Seq.toUnfoldable classes
        , toplevels: SM.mapWithKey (const typeToJS) toplevelsStrMap
        }
