module Swift
    ( renderSwiftClass
    ) where

import Doc
import IR
import Prelude

import Data.Foldable (for_, intercalate)
import Data.Function (on)
import Data.List (List(..), groupBy)
import Data.List as L
import Data.List.NonEmpty as NE
import Data.Tuple (Tuple(..))
import Data.Map as M

import Data.Set as S

renderSwiftClass :: IRClassData -> Doc Unit
renderSwiftClass { name, properties } = do
    line $ words ["struct", name]
    line "{"
    indent do
        let props = properties # M.toUnfoldable <#> \(Tuple name typ) -> { name, typ }
        let propGroups = L.groupBy (eq `on` _.typ) props
        for_ propGroups renderPropGroup
    line "}"

renderPropGroup :: NE.NonEmptyList { name :: String, typ :: IRType} -> Doc Unit
renderPropGroup props = line do
    let names = intercalate ", " (_.name <$> props)
    words ["let", names <> ":"]
    string " "

    let { typ } = NE.head props
    string $ renderType typ

renderType :: IRType -> String
renderType = case _ of
    IRNothing -> "Any"
    IRNull -> "Any"
    IRInteger -> "Int"
    IRDouble -> "Double"
    IRBool -> "Bool"
    IRString -> "String"
    IRArray a -> "[" <> renderType a <> "]"
    IRClass { name } -> name
    IRUnion s ->  "Either<" <> intercalate ", " (S.map renderType s) <> ">"