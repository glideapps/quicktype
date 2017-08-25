module Config
    ( parseConfig
    , Config(..)
    , TypeSource(..)
    , TopLevelConfig(..)
    , topLevelSamples
    , topLevelSchemas
    , renderer
    ) where

import Data.Argonaut.Decode
import Prelude

import Control.Alt ((<|>))
import Data.Argonaut.Core (JObject, Json)
import Data.Array as A
import Data.Either (Either(Right, Left))
import Data.Foldable (elem, find)
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(Just), fromMaybe, maybe)
import Data.Tuple (Tuple(..))
import Doc (Renderer)
import Doc as Doc
import Language.JsonSchema (JSONSchema)
import Language.Renderers as Renderers

data TypeSource
    = Literal String
    | Json Json

data TopLevelConfig = TopLevelConfig
    { name :: String
    , samples :: Array TypeSource
    , schema :: Maybe JSONSchema
    }

newtype Config = Config
    { topLevels :: Array TopLevelConfig
    , language :: String
    }

instance decodeTypeSource :: DecodeJson TypeSource where
    decodeJson j =
        (Literal <$> decodeJson j)
        <|>
        (Json <$> decodeJson j)

instance decodeTopLevelConfig :: DecodeJson TopLevelConfig where
    decodeJson j = do
        obj <- decodeJson j
        name <- obj .? "name"

        sample <- obj .?? "sample"
        samples <- obj .?? "samples"

        let samples' = maybe samples (\s -> Just [s]) sample

        schema <- obj .?? "schema"
        pure $ TopLevelConfig
            { name
            , samples: fromMaybe [] samples'
            , schema
            }

instance decodeConfig :: DecodeJson Config where
    decodeJson j = do
        obj <- decodeJson j
        topLevels <- obj .? "topLevels"
        language <- obj .? "language"
        pure $ Config
            { topLevels
            -- TODO derive from outFile
            , language
            }

parseConfig :: Json -> Either String Config
parseConfig = decodeJson

renderer :: Config -> Either String Doc.Renderer
renderer (Config { language }) =
    maybe
    (Left $ language <> " not supported")
    Right
    (find match Renderers.all)
    where
        match :: Renderer -> Boolean
        match ({ aceMode, name, extension }) = elem language [aceMode, name, extension]

topLevelsMap :: Config -> Map String TopLevelConfig
topLevelsMap (Config { topLevels }) =
    topLevels
    <#> (\top@(TopLevelConfig { name }) -> Tuple name top)
    # Map.fromFoldable

topLevelSamples :: Config -> Map String (Array TypeSource)
topLevelSamples config = loadTypeSources <$> topLevelsMap config

loadTypeSources :: TopLevelConfig -> Array TypeSource
loadTypeSources (TopLevelConfig config) = config.samples

topLevelSchemas :: Config -> Map String (Array JSONSchema)
topLevelSchemas (Config config) = withSchemas
    where
      withSchemas =
        config.topLevels
        <#> getNameAndSchema
        # A.catMaybes
        # Map.fromFoldable

      getNameAndSchema (TopLevelConfig { name, schema }) = do
        s <- schema
        pure $ Tuple name [s]