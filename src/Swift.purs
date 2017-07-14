module Swift
    ( renderSwiftClass
    ) where

import Prelude

import Doc
import IR

import Data.Foldable (for_, intercalate)
import Data.Function (on)

import Data.List as L
import Data.List.NonEmpty as NE

import Data.Map as M

import Data.Set as S
import Data.Tuple (Tuple(..))


renderSwiftClass :: IRClassData -> Doc Unit
renderSwiftClass { name, properties } = do
    line $ words ["struct", name]
    line "{"
    indent do
        let props = properties # M.toUnfoldable <#> \(Tuple name typ) -> { name, typ }
        let propGroups = L.groupBy (eq `on` _.typ) props
        for_ propGroups renderPropGroup
    line "}"
    
    blank

    for_ (M.values properties) renderUnions

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
    IRUnion s ->  unionName s

renderUnions :: IRType -> Doc Unit
renderUnions = case _ of
    IRUnion s -> do
        renderUnion s
        for_ (S.toUnfoldable s :: Array _) renderUnions 
    IRArray (IRUnion s) -> renderUnion s
    _ -> pure unit

unionName :: S.Set IRType -> String
unionName s = intercalate "Or" $ (caseName <$> S.toUnfoldable s :: Array _)

caseName :: IRType -> String
caseName = case _ of
    IRArray a -> renderType a <> "s"
    IRUnion s ->  unionName s
    t -> renderType t

renderUnion :: S.Set IRType -> Doc Unit
renderUnion types = do
    line $ words ["enum", unionName types, "{"]
    indent do
        for_ types \typ -> line do
            string "case ."
            string $ "some" <> caseName typ
            string "("
            string $ renderType typ
            string ")"
    line "}"
    blank

