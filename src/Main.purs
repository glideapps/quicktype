module Main where

import Prelude

import Control.Plus (empty)
import Data.Argonaut.Core (Json, foldJson)
import Data.Argonaut.Parser (jsonParser)
import Data.Either (Either)
import Data.Foldable (find)
import Data.Maybe (Maybe(..))

import Data.List ((:))
import Data.List as L
import Data.Tuple as Tuple
import Data.List.Types (List(..))
import Data.StrMap as StrMap
import Data.Map as Map
import Data.Foldable (for_)
import Data.Set as S

import IR

import Doc (Doc())
import Doc as Doc

--import Swift as Swift
import CSharp as CSharp

type Renderer = IRClassData -> Doc Unit

renderers = {
    csharp: CSharp.renderCSharpClass
--    swift: Swift.renderSwiftClass
}

unifyClasses :: IRClassData -> IRClassData -> IRClassData
unifyClasses { name: na, properties: pa } { name: nb, properties: pb } =
    { name: na, properties: Map.unionWith unifyTypes pa pb }

removeElement :: forall a. Ord a => (a -> Boolean) -> S.Set a -> { element :: Maybe a, rest :: S.Set a }
removeElement p s =
    let element = (find p s)
    in
        case element of
            Just x -> { element: element, rest: S.difference s (S.delete x s) }
            Nothing -> { element: element, rest: s }

isArray :: IRType -> Boolean
isArray (IRArray _) = true
isArray _ = false

isClass :: IRType -> Boolean
isClass (IRClass _) = true
isClass _ = false

unifyMaybes :: Maybe IRType -> Maybe IRType -> IRType
unifyMaybes Nothing Nothing = IRNothing
unifyMaybes (Just a) Nothing = a
unifyMaybes Nothing (Just b) = b
unifyMaybes (Just a) (Just b) = unifyTypes a b

setFromType :: IRType -> S.Set IRType
setFromType IRNothing = S.empty
setFromType x = S.singleton x

unifyUnion :: S.Set IRType -> S.Set IRType -> S.Set IRType
unifyUnion sa sb =
    let { element: arrayA, rest: sa } = removeElement isArray sa
        { element: arrayB, rest: sb } = removeElement isArray sb
        { element: classA, rest: sa } = removeElement isClass sa
        { element: classB, rest: sb } = removeElement isClass sb
        unifiedArray = setFromType $ unifyMaybes arrayA arrayB
        unifiedClasses = setFromType $ unifyMaybes classA classB
    in
        S.unions [sa, sb, unifiedArray, unifiedClasses]

unifyTypes :: IRType -> IRType -> IRType
unifyTypes IRNothing x = x
unifyTypes x IRNothing = x
unifyTypes (IRArray a) (IRArray b) = IRArray (unifyTypes a b)
unifyTypes (IRClass a) (IRClass b) = IRClass (unifyClasses a b)
unifyTypes (IRUnion a) (IRUnion b) = IRUnion (unifyUnion a b)
unifyTypes (IRUnion a) b = IRUnion (unifyUnion a (S.singleton b))
unifyTypes a (IRUnion b) = IRUnion (unifyUnion (S.singleton a) b)
unifyTypes a b = if a == b then a else IRUnion (S.fromFoldable [a, b])

makeTypeFromJson :: String -> Json -> IRType
makeTypeFromJson name json = foldJson
    (const IRNull)
    (const IRBool)
    (const IRDouble)
    (const IRString)
    -- Convert from Array to List before we match to make things tidier (foldJson is pretty crude)
    (\arr -> let singular = singularize name
        in
            IRArray (L.foldl (\t j -> unifyTypes t (makeTypeFromJson singular j)) IRNothing arr))
    fromJObject
    json
    where
        fromJObject obj = IRClass { name, properties: Map.fromFoldable $ StrMap.foldMap toProperty obj }
        toProperty name json = L.singleton $ Tuple.Tuple name (makeTypeFromJson name json)

singularize :: String -> String
singularize s = "OneOf" <> s

gatherClassesFromType :: IRType -> L.List IRClassData
gatherClassesFromType = case _ of 
    IRClass cls -> cls : L.concatMap gatherClassesFromType (Map.values cls.properties)
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
