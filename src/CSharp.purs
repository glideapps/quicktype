module CSharp 
    ( renderer
    ) where


import Doc
import IR
import Prelude
import Types

import Data.Foldable (for_, intercalate)
import Data.List (List, (:))
import Data.List as L
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Set as Set
import Data.String.Util (capitalize, camelCase)
import Data.Tuple as Tuple

renderer :: Renderer
renderer =
    { name: "C#"
    , aceMode: "csharp"
    , render: renderCSharp
    }

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
    IRClass (IRClassData name _) -> csNameStyle name
    IRUnion types -> renderUnionToCSharp types

renderCSharp :: L.List IRClassData -> Doc Unit
renderCSharp classes = do
    line "namespace QuickType"
    line "{"
    blank
    
    indent do
        line "using Newtonsoft.Json.JsonPropertyAttribute;"
        blank
        for_ classes \cls -> do
            renderCSharpClass cls
            blank
    line "}"

csNameStyle :: String -> String
csNameStyle = camelCase >>> capitalize

renderCSharpClass :: IRClassData -> Doc Unit
renderCSharpClass (IRClassData name properties) = do
    line $ words ["class", csNameStyle name]
    line "{"
    indent do
        for_ (Map.toUnfoldable properties :: Array _) \(Tuple.Tuple pname ptype) -> do
            line do
                string "[JsonProperty(\""
                string pname
                string "\")]"
            line do
                string "public "
                string $ renderTypeToCSharp ptype
                words ["", csNameStyle pname, "{ get; set; }"]
                blank
    line "}"
