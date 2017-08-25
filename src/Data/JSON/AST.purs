module Data.JSON.AST
    ( parse
    , Node(..)
    , Property(..)
    , Literal(..)
    ) where

import Core

import Data.Argonaut.Core (Json, isBoolean, isNull, isNumber, isString)
import Data.Argonaut.Decode (class DecodeJson, decodeJson, (.?))

type MkEither a b =
    { success :: b -> Either a b
    , fail :: a -> Either a b
    }

mkEither :: forall a b. MkEither a b
mkEither = { success: Right, fail: Left }

foreign import _parse :: MkEither String Json -> String -> Either String Json

parse :: String -> Either String Node
parse s = do
    obj <- _parse mkEither s
    decodeJson obj

data Property = Property { label :: String, node :: Node }

data Key = Key String

data Literal
    = String String
    | Boolean Boolean
    | Null
    | Number Number String

data Node
    = Literal Literal
    | Object (Array Property)
    | Array (Array Node)

instance decodeLiteral:: DecodeJson Literal where
    decodeJson j = do
        obj <- decodeJson j
        val <- obj .? "value"
        raw <- obj .? "rawValue"
        case val of
            _ | isString val ->
                String <$> decodeJson val
            _ | isBoolean val ->
                Boolean <$> decodeJson val
            _ | isNull val ->
                pure Null
            _ | isNumber val -> do
                n <- decodeJson val
                pure $ Number n raw
            _ -> Left $ "Could not decode literal: " <> raw

instance decodeKey :: DecodeJson Key where
    decodeJson j = do
        obj <- decodeJson j
        label <- obj .? "value"
        pure $ Key label

instance decodeProperty :: DecodeJson Property where
    decodeJson :: Json -> Either String Property
    decodeJson j = do
        obj <- decodeJson j
        Key label <- obj .? "key"
        node <- obj .? "value"
        pure $ Property { label, node }

instance decodeNode :: DecodeJson Node where
  decodeJson j = do
    obj <- decodeJson j
    typ <- obj .? "type"
    case typ of
        "object" -> do
            props <- obj .? "children"
            pure $ Object props
        "literal" -> do
            literal <- decodeJson j
            pure $ Literal literal
        "array" -> do
            children <- obj .? "children"
            pure $ Array children
        _ -> Left "Unsupported JSON value"