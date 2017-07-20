module CSharp 
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude
import Types

import Data.Foldable (for_, intercalate)
import Data.List (List, fromFoldable, (:))
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
    , doc: csharpDoc
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

renderUnionToCSharp :: IRGraph -> Set.Set IRType -> String
renderUnionToCSharp graph s =
    case nullableFromSet s of
    Just x -> if isValueType x then renderTypeToCSharp graph x <> "?" else renderTypeToCSharp graph x
    Nothing -> "Either<" <> intercalate ", " (map (renderTypeToCSharp graph) (L.fromFoldable s)) <> ">"

renderTypeToCSharp :: IRGraph -> IRType -> String
renderTypeToCSharp graph = case _ of
    IRNothing -> "object"
    IRNull -> "object"
    IRInteger -> "int"
    IRDouble -> "double"
    IRBool -> "bool"
    IRString -> "string"
    IRArray a -> renderTypeToCSharp graph a <> "[]"
    IRClass i ->
        let IRClassData { names: names, properties } = getClassFromGraph graph i
        in
            csNameStyle $ combineNames names
    IRMap t -> "Dictionary<string, " <> renderTypeToCSharp graph t <> ">"
    IRUnion types -> renderUnionToCSharp graph types

csNameStyle :: String -> String
csNameStyle = camelCase >>> capitalize

csharpDoc :: Doc Unit
csharpDoc = do
    lines """namespace QuickType
             {"""
    blank
    indent do
        lines """using System.Net;
                 using Newtonsoft.Json;"""
        blank
        classes <- getClasses
        for_ classes \cls -> do
            renderCSharpClass cls
            blank
    lines "}"

renderCSharpClass :: IRClassData -> Doc Unit
renderCSharpClass (IRClassData { names, properties }) = do
    line $ words ["class", csNameStyle $ combineNames names]

    lines "{"
    indent do
        for_ (Map.toUnfoldable properties :: Array _) \(Tuple.Tuple pname ptype) -> do
            line do
                string "[JsonProperty(\""
                string pname
                string "\")]"
            line do
                string "public "
                graph <- getGraph
                string $ renderTypeToCSharp graph ptype
                words ["", csNameStyle pname, "{ get; set; }"]
            blank
        
        -- TODO don't rely on 'TopLevel'
        when (names == Set.singleton "TopLevel") do
            lines """// Loading helpers
                     public static TopLevel FromJson(string json) => JsonConvert.DeserializeObject<TopLevel>(json);"""
    lines "}"
