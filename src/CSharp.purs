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
    IRUnion types -> "Either<" <> intercalate ", " (Set.map renderTypeToCSharp types) <> ">"

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
