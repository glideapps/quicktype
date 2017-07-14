module Main where

import Prelude

import Control.Plus (empty)
import Data.Argonaut.Core (Json, foldJson)
import Data.Argonaut.Parser (jsonParser)
import Data.Either (Either)

import Data.List ((:))
import Data.List as L
import Data.List.Types (List(..))
import Data.StrMap as StrMap
import Data.Foldable (for_)

import IR

import Doc (Doc())
import Doc as Doc

import Swift as Swift
import CSharp as CSharp

type Renderer = IRClassData -> Doc Unit

renderers = {
    csharp: CSharp.renderCSharpClass,
    swift: Swift.renderSwiftClass
}

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

renderClasses :: Renderer -> L.List IRClassData -> Doc Unit
renderClasses renderer classes = for_ classes \cls -> do
    renderer cls
    Doc.blank

jsonToCSharp :: String -> Either String String
jsonToCSharp json =
    jsonParser json
    <#> makeTypeFromJson "TopLevel"
    <#> gatherClassesFromType
    <#> renderClasses renderers.csharp
    <#> Doc.render
