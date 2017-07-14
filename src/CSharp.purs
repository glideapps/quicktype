module CSharp 
    ( renderCSharpClass
    ) where

import Prelude

import IR
import Doc

import Data.Foldable (for_)
import Data.Tuple as Tuple
import Data.Map as Map
import Data.String as String
import Data.Array as Array

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
    IRUnion types -> "Either<" <> String.joinWith ", " (map renderTypeToCSharp (Array.fromFoldable types)) <> ">"

renderCSharpClass :: IRClassData -> Doc Unit
renderCSharpClass { name, properties } = do
    line $ words ["class", name]
    line "{"
    indent do
        for_ (Map.toUnfoldable properties :: Array _) \(Tuple.Tuple pname ptype) -> line do
            string "public "
            string $ renderTypeToCSharp ptype
            words ["", pname, "{ get; set; }"]
    line "}"
