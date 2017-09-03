module IRTypeable where

import Config (TypeSource(..))
import Core

import Control.Monad.Except (except)
import Data.Argonaut.Core (Json, foldJson)
import Data.JSON.AST as A
import Data.List (fromFoldable)
import Data.Map (Map)
import Data.Map as Map
import Data.StrMap as SM
import Data.String.Util (isInt, singular)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import IR (IR, addClass, addTopLevel, unifyMultipleTypes)
import IRGraph (IRType(..), Named(..), makeClass, namedValue)
import Language.JsonSchema (JSONSchema, jsonSchemaListToIR)
import Utils (forMapM_)

-- | `IRTypeable` contains types that we can generate an `IRType` from
class IRTypeable a where
    makeType :: Named String -> a -> IR IRType

makeTypes :: forall a. IRTypeable a => Map Name (Array a) -> IR Unit
makeTypes typeableMap = do
    forMapM_ typeableMap \name typeables -> do
        topLevelTypes <- traverse (makeType $ Given name) typeables
        topLevel <- unifyMultipleTypes $ fromFoldable topLevelTypes
        addTopLevel name topLevel

instance typeableTypeSource :: IRTypeable TypeSource where
    makeType name = case _ of
        Literal jsonString -> makeType name jsonString
        Json json -> makeType name json

instance typeableString :: IRTypeable String where
    -- Strings are typed by converting to an AST, then typing that.
    makeType name jsonString = do
        ast <- except $ A.parse jsonString
        makeType name ast

instance typeableJSONSchema :: IRTypeable JSONSchema where
    makeType name schema = jsonSchemaListToIR name [schema]

intSentinel :: String
intSentinel = "D5F20AD6-0D08-4048-B734-9100AF225906"

instance typeableJson :: IRTypeable Json where
    makeType name json =
        foldJson
        (\_ -> pure IRNull)
        (\_ -> pure IRBool)
        (\n -> pure IRDouble)
        (\_ -> pure IRString)
        (\arr -> do
            let typeName = singular $ namedValue name
            typeList <- traverse (makeType $ Inferred typeName) $ fromFoldable arr
            unifiedType <- unifyMultipleTypes typeList
            pure $ IRArray unifiedType)
        (case _ of
            obj | isIntSentinel obj -> pure IRInteger
            obj -> do
                let l1 = SM.toUnfoldable obj :: Array (Tuple String Json)
                l2 <- traverse toProperty l1
                addClass $ makeClass name $ Map.fromFoldable l2)
        json
        where
            toProperty (Tuple name' json') = Tuple name' <$> makeType (Inferred name') json'

            isIntSentinel o
                | SM.size o == 1, Just _ <- SM.lookup intSentinel o = true
                | otherwise = false

instance typeableAst :: IRTypeable A.Node where
    makeType name = case _ of
        A.Literal A.Null -> pure IRNull
        A.Literal (A.Boolean _) -> pure IRBool
        A.Literal (A.String _) -> pure IRString

        A.Literal (A.Number _ raw)
            | isInt raw -> pure IRInteger
            | otherwise -> pure IRDouble

        A.Array nodes -> do
            let typeName = singular $ namedValue name
            typeList <- traverse (makeType $ Inferred typeName) $ fromFoldable nodes
            unifiedType <- unifyMultipleTypes typeList
            pure $ IRArray unifiedType

        A.Object props -> do
            props' <- traverse toProperty props
            addClass $ makeClass name $ Map.fromFoldable props'

        where
            toProperty (A.Property { label, node }) = Tuple label <$> makeType (Inferred label) node
