module CSharp 
    ( renderCSharpClass
    ) where

import Doc
import IR
import Prelude


import Data.Foldable (for_, intercalate)
import Data.Map as Map
import Data.Set as Set
import Data.Tuple as Tuple
import Data.List as L
import Data.List ((:))
import Data.Maybe (Maybe(..))
import Data.String.Util (capitalize)

isValueType :: IRType -> Boolean
isValueType IRInteger = true
isValueType IRDouble = true
isValueType IRBool = true
isValueType _ = false

nullableFromSet :: Set.Set IRType -> Maybe IRType
nullableFromSet s =
    case L.fromFoldable s of
    IRNull : x : L.Nil -> Just x
    x : IRNull : L.Nil -> Just x
    _ -> Nothing

renderUnionToCSharp :: Set.Set IRType -> String
renderUnionToCSharp s =
    case nullableFromSet s of
    Just x -> if isValueType x then renderTypeToCSharp x <> "?" else renderTypeToCSharp x
    Nothing -> "Either<" <> intercalate ", " (Set.map renderTypeToCSharp s) <> ">"

renderTypeToCSharp :: IRType -> String
renderTypeToCSharp = case _ of
    IRNothing -> "object"
    IRNull -> "object"
    IRInteger -> "int"
    IRDouble -> "double"
    IRBool -> "bool"
    IRString -> "string"
    IRArray a -> renderTypeToCSharp a <> "[]"
    IRClass { name } -> name
    IRUnion types -> renderUnionToCSharp types

renderCSharpClass :: IRClassData -> Doc Unit
renderCSharpClass { name, properties } = do
    line $ words ["class", name]
    line "{"
    indent do
        for_ (Map.toUnfoldable properties :: Array _) \(Tuple.Tuple pname ptype) -> line do
            string "public "
            string $ renderTypeToCSharp ptype
            words ["", capitalize pname, "{ get; set; }"]
    line "}"
