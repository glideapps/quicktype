module Main where

import Doc
import Prelude

import Control.Plus (empty)
import Data.Argonaut.Core (Json, foldJson)
import Data.Argonaut.Parser (jsonParser)
import Data.Either (Either)
import Data.Foldable (for_)
import Data.List ((:))
import Data.List as L
import Data.List.Types (List(..))
import Data.StrMap as StrMap

type IRProperty = { name :: String, typ :: IRType }
type IRClassData = { name :: String, properties :: L.List IRProperty }

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

makeTypeFromJson :: String -> Json -> IRType
makeTypeFromJson name json = foldJson
    (const IRNull)
    (const IRBool)
    (const IRDouble)
    (const IRString)
    -- Convert from Array to List before we match to make things tidier (foldJson is pretty crude)
    (L.fromFoldable >>> case _ of
        Nil -> IRArray IRNothing
        Cons x _ -> IRArray $ makeTypeFromJson (singularize name) x)
    fromJObject
    json
    where
        fromJObject obj = IRClass { name, properties: StrMap.foldMap toProperty obj }
        toProperty name json = L.singleton { name, typ: makeTypeFromJson name json }

singularize :: String -> String
singularize s = "OneOf" <> s

gatherClassesFromType :: IRType -> L.List IRClassData
gatherClassesFromType = case _ of 
    IRClass cls -> cls : L.concatMap (gatherClassesFromType <<< _.typ) cls.properties
    IRArray t -> gatherClassesFromType t
    _ -> empty

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
    IRUnion _ -> "FIXME"

renderClassToCSharp :: IRClassData -> Doc Unit
renderClassToCSharp { name, properties } = do
    line $ words ["class", name]
    line "{"
    indent do
        for_ properties \p -> line do
            string "public "
            string $ renderTypeToCSharp p.typ
            words ["", p.name, "{ get; set; }"]
    line "}"

renderClassesToCSharp :: L.List IRClassData -> Doc Unit
renderClassesToCSharp classes = for_ classes \cls -> do
    renderClassToCSharp cls
    blank

jsonToCSharp :: String -> Either String String
jsonToCSharp json =
    jsonParser json
    <#> makeTypeFromJson "TopLevel"
    <#> gatherClassesFromType
    <#> renderClassesToCSharp
    <#> render
