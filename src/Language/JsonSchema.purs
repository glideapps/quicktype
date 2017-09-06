module Language.JsonSchema
    ( JSONSchema
    , jsonSchemaListToIR
    , renderer
    ) where

import Core (class Eq, class Ord, Error, Unit, unit, bind, const, map, not, otherwise, pure, ($), (&&), (/=), (<), (<$>), (<>), (=<<), (>=), (>>>))

import Doc (Doc, Renderer, combineNames, getClasses, getTopLevels, line, lookupClassName, noForbidNamer, simpleNamer)
import IRGraph
import Control.Monad.Error.Class (throwError)

import Data.Argonaut.Core (Json, foldJson, fromArray, fromBoolean, fromObject, fromString, isBoolean, stringifyWithSpace)
import Data.Argonaut.Decode ((.??), decodeJson, class DecodeJson)
import Data.Array as A
import Data.Char as Char
import Data.Either (Either(Right, Left))
import Data.Foldable (class Foldable, foldM)
import Data.List (List, (:))
import Data.List as L
import Data.List.NonEmpty as NEL
import Control.Monad.State.Trans as StateT
import Data.Map as M
import Data.Maybe (Maybe(..), maybe)
import Data.Set (Set)
import Data.Set as S
import Data.StrMap (StrMap)
import Data.StrMap as SM
import Data.String as String
import Data.String.Util (camelCase, capitalize, singular)
import Data.Traversable (class Traversable, traverse)
import Data.Tuple (Tuple(..))
import IR (IR, addClass, unifyTypes)
import Utils (mapM, mapMapM, mapWithIndexM)

data JSONType
    = JSONObject
    | JSONArray
    | JSONBoolean
    | JSONString
    | JSONNull
    | JSONInteger
    | JSONNumber

derive instance eqJSONType :: Eq JSONType
derive instance ordJSONType :: Ord JSONType

jsonTypeEnumMap :: StrMap JSONType
jsonTypeEnumMap = SM.fromFoldable [
    Tuple "object" JSONObject, Tuple "array" JSONArray, Tuple "boolean" JSONBoolean,
    Tuple "string" JSONString, Tuple "null" JSONNull, Tuple "integer" JSONInteger,
    Tuple "number" JSONNumber
    ]

data PathElement
    = Root
    | Definition String
    | OneOf Int
    | Property String
    | AdditionalProperty
    | Items

newtype JSONSchemaRef = JSONSchemaRef
    { path :: NEL.NonEmptyList PathElement
    , name :: Maybe String
    }

newtype JSONSchema = JSONSchema
    { definitions :: Maybe (StrMap JSONSchema)
    , ref :: Maybe JSONSchemaRef
    , types :: Maybe (Either JSONType (Set JSONType))
    , oneOf :: Maybe (Array JSONSchema)
    , properties :: Maybe (StrMap JSONSchema)
    , additionalProperties :: Either Boolean JSONSchema
    , items :: Maybe JSONSchema
    , required :: Maybe (Array String)
    , title :: Maybe String
    }

type JsonIR = StateT.StateT Unit IR

decodeEnum :: forall a. StrMap a -> Json -> Either Error a
decodeEnum sm j = do
    key <- decodeJson j
    maybe (Left "Unexpected enum key") Right $ SM.lookup key sm

instance decodeJsonType :: DecodeJson JSONType where
    decodeJson = decodeEnum jsonTypeEnumMap

instance decodeJsonSchemaRef :: DecodeJson JSONSchemaRef where
    decodeJson j = do
        refString :: String <- decodeJson j
        let pathElementsStrings = String.split (String.Pattern "/") refString
        parsed <- parseJsonSchemaRef $ L.fromFoldable pathElementsStrings
        case NEL.fromList parsed of
            Nothing -> Left "Reference must contain at least one path element"
            Just path -> pure $ JSONSchemaRef { path, name: A.last pathElementsStrings }

parseJsonSchemaRef :: List String -> Either Error (List PathElement)
parseJsonSchemaRef L.Nil =
    pure L.Nil
parseJsonSchemaRef ("#" : rest) = do
    restParsed <- parseJsonSchemaRef rest
    pure $ Root : restParsed
parseJsonSchemaRef ("definitions" : name : rest) = do
    restParsed <- parseJsonSchemaRef rest
    pure $ Definition name : restParsed
parseJsonSchemaRef _ =
    Left "Could not parse JSON Schema reference"

decodeTypes :: Json -> Either Error (Either JSONType (Set JSONType))
decodeTypes j =
    foldJson
        (\_ -> Left "`types` cannot be null")
        (\_ -> Left "`types` cannot be a boolean")
        (\_ -> Left "`types` cannot be a number")
        (\s -> do
            t <- decodeEnum jsonTypeEnumMap j
            pure $ Left t)
        (\a -> do
            l <- traverse (decodeEnum jsonTypeEnumMap) a
            pure $ Right $ S.fromFoldable l)
        (\_ -> Left "`Types` cannot be an object")
        j

decodeAdditionalProperties :: Maybe Json -> Either Error (Either Boolean JSONSchema)
decodeAdditionalProperties Nothing = Right $ Left true
decodeAdditionalProperties (Just j)
    | isBoolean j = do
        b <- decodeJson j
        pure $ Left b
    | otherwise = do
        js <- decodeJson j
        pure $ Right js

instance decodeJsonSchema :: DecodeJson JSONSchema where
    decodeJson j = do
        obj <- decodeJson j
        definitions <- obj .?? "definitions"
        ref <- obj .?? "$ref"
        
        typ <- obj .?? "type"
        -- TODO this sucks
        types <- maybe (pure Nothing) (map Just) (decodeTypes <$> typ)
                    
        oneOf <- obj .?? "oneOf"
        properties <- obj .?? "properties"
        additionalProperties <- decodeAdditionalProperties $ SM.lookup "additionalProperties" obj
        items <- obj .?? "items"
        required <- obj .?? "required"
        title <- obj .?? "title"
        pure $ JSONSchema { definitions, ref, types, oneOf, properties, additionalProperties, items, required, title }

lookupRef :: JSONSchema -> List PathElement -> List PathElement -> JSONSchema -> Either Error (Tuple JSONSchema (List PathElement))
-- FIXME: don't deconstruct all the properties
lookupRef root reversePath ref local@(JSONSchema { definitions, oneOf, properties, additionalProperties, items }) =
    case ref of
    L.Nil -> Right $ Tuple local reversePath
    Root : rest -> lookupRef root (L.singleton Root) rest root
    Definition name : rest ->
    -- FIXME: use >>= for all these maybes
        case definitions of
        Just sm ->
            case SM.lookup name sm of
            Just js -> recur (Definition name) rest js
            Nothing -> Left "Reference not found"
        Nothing -> Left "Definitions not found"
    OneOf i : rest ->
        case oneOf of
        Just oo ->
            case A.index oo i of
            Just js -> recur (OneOf i) rest js
            Nothing -> Left "Invalid OneOf index"
        Nothing -> Left "OneOf not found"
    Property name : rest ->
        case properties of
        Just props ->
            case SM.lookup name props of
            Just js -> recur (Property name) rest js
            Nothing -> Left "Property not found"
        Nothing -> Left "Properties not found"
    AdditionalProperty : rest ->
        case additionalProperties of
        Right js -> recur AdditionalProperty rest js
        _ -> Left "AdditionalProperties not found"
    Items : rest ->
        case items of
        Just js -> recur Items rest js
        Nothing -> Left "Items not found"
    where
        recur pathElement rest js = lookupRef root (pathElement : reversePath) rest js

jsonUnifyTypes :: IRType -> IRType -> JsonIR IRType
jsonUnifyTypes a b = StateT.lift $ unifyTypes a b

toIRAndUnify :: forall a f. Foldable f => (Int -> a -> JsonIR IRType) -> f a -> JsonIR IRType
toIRAndUnify toIR l = do
    irs <- mapWithIndexM toIR $ A.fromFoldable l
    foldM jsonUnifyTypes IRAnything irs

jsonSchemaToIR :: JSONSchema -> List PathElement -> Named String -> JSONSchema -> JsonIR IRType
-- FIXME: don't deconstruct all the properties
jsonSchemaToIR root reversePath name schema@(JSONSchema { definitions, ref, types, oneOf, properties, additionalProperties, items, required })
    | Just (JSONSchemaRef { path, name }) <- ref =
        case lookupRef root reversePath (NEL.toList path) schema of
        Left err -> throwError err
        Right (Tuple js jsReversePath) -> jsonSchemaToIR root jsReversePath (maybe (Inferred "Something") Given name) js
    | Just (Left jt) <- types =
        jsonTypeToIR root reversePath name jt schema
    | Just (Right jts) <- types =
        toIRAndUnify (\_ jt -> jsonTypeToIR root reversePath name jt schema) jts
    | Just jss <- oneOf =
        toIRAndUnify (\i -> jsonSchemaToIR root (OneOf i : reversePath) name) jss
    | otherwise =
        pure IRAnything

jsonSchemaListToIR :: forall t. Traversable t => Named String -> t JSONSchema -> IR IRType
jsonSchemaListToIR name l = do
    irTypes <- StateT.evalStateT (mapM (\js -> jsonSchemaToIR js (L.singleton Root) name js) l) unit
    foldM unifyTypes IRAnything irTypes

jsonTypeToIR :: JSONSchema -> List PathElement -> Named String -> JSONType -> JSONSchema -> JsonIR IRType
jsonTypeToIR root reversePath name jsonType (JSONSchema schema) =
    case jsonType of
    JSONObject ->
        case schema.properties of
        Just sm -> do
            let propMap = M.fromFoldable $ SM.toUnfoldable sm :: Array (Tuple String JSONSchema)
            props <- mapMapM (\n -> jsonSchemaToIR root (Property n : reversePath) $ Inferred n) propMap
            let required = maybe S.empty S.fromFoldable schema.required
            let title = maybe name Given schema.title
            nulled <- mapMapM (\n -> if S.member n required then pure else jsonUnifyTypes IRNull) props
            StateT.lift $ addClass $ makeClass title nulled
        Nothing ->
            case schema.additionalProperties of
            Left true ->
                pure $ IRMap IRAnything
            Left false ->
                pure $ IRAnything
            Right js -> do
                ir <- jsonSchemaToIR root (AdditionalProperty : reversePath) singularName js
                pure $ IRMap ir
    JSONArray ->
        case schema.items of
        Just js -> do
            ir <- jsonSchemaToIR root (Items : reversePath) singularName js
            pure $ IRArray ir
        Nothing -> pure $ IRArray IRAnything
    JSONBoolean -> pure IRBool
    JSONString -> pure IRString
    JSONNull -> pure IRNull
    JSONInteger -> pure IRInteger
    JSONNumber -> pure IRDouble
    where
        singularName = Inferred $ singular $ namedValue name

forbiddenNames :: Array String
forbiddenNames = []

renderer :: Renderer
renderer =
    { name: "Schema"
    , aceMode: "json"
    , extension: "schema"
    , doc: jsonSchemaDoc
    , options: []
    , transforms:
        { nameForClass: simpleNamer nameForClass
        , nextName: \s -> "Other" <> s
        , forbiddenNames
        , topLevelName: noForbidNamer jsonNameStyle -- FIXME: put title on top levels, too
        , unions: Nothing
        }
    }

legalize :: String -> String
legalize s =
    String.fromCharArray $ map (\c -> if isLegal c then c else '_') (String.toCharArray s)
    where
        isLegal c =
            let cc = Char.toCharCode c
            in cc >= 32 && cc < 128 && c /= '/'

jsonNameStyle :: String -> String
jsonNameStyle =
    legalize >>> camelCase >>> capitalize

nameForClass :: IRClassData -> String
nameForClass (IRClassData { names }) = jsonNameStyle $ combineNames names

typeStrMap :: String -> Doc (StrMap Json)
typeStrMap s = pure $ SM.insert "type" (fromString s) SM.empty

typeJson :: String -> Doc Json
typeJson s = fromObject <$> typeStrMap s

strMapForType :: IRType -> Doc (StrMap Json)
strMapForType t =
    case t of
    IRAnything -> pure $ SM.empty
    IRNull -> typeStrMap "null"
    IRInteger -> typeStrMap "integer"
    IRDouble -> typeStrMap "number"
    IRBool -> typeStrMap "boolean"
    IRString -> typeStrMap "string"
    IRArray a -> do
        itemType <- jsonForType a
        sm <- typeStrMap "array"
        pure $ SM.insert "items" itemType sm
    IRClass i -> do
        name <- lookupClassName i
        pure $ SM.insert "$ref" (fromString $ "#/definitions/" <> name) SM.empty
    IRMap m -> do
        propertyType <- jsonForType m
        sm <- typeStrMap "object"
        pure $ SM.insert "additionalProperties" propertyType sm
    IRUnion ur -> do
        types <- mapUnionM jsonForType ur
        let typesJson = fromArray $ A.fromFoldable types
        pure $ SM.insert "oneOf" typesJson SM.empty

jsonForType :: IRType -> Doc Json
jsonForType t = do
    sm <- strMapForType t
    pure $ fromObject sm

strMapForOneOfTypes :: List IRType -> Doc (StrMap Json)
strMapForOneOfTypes L.Nil = pure $ SM.empty
strMapForOneOfTypes (t : L.Nil) = strMapForType t
strMapForOneOfTypes typeList = do
    objList <- mapM jsonForType typeList
    pure $ SM.insert "oneOf" (fromArray $ A.fromFoldable objList) SM.empty

definitionForClass :: Tuple Int IRClassData -> Doc (Tuple String Json)
definitionForClass (Tuple i (IRClassData { names, properties })) = do
    className <- lookupClassName i
    let sm = SM.insert "additionalProperties" (fromBoolean false) $ SM.insert "type" (fromString "object") SM.empty
    propsMap <- mapMapM (const jsonForType) properties
    let requiredProps = A.fromFoldable $ map fromString $ M.keys $ M.filter (\t -> not $ canBeNull t) properties
    let propsSM = SM.fromFoldable $ (M.toUnfoldable propsMap :: List (Tuple String Json))
    let withProperties = SM.insert "properties" (fromObject propsSM) sm
    let withRequired = SM.insert "required" (fromArray requiredProps) withProperties
    let withTitle = SM.insert "title" (fromString $ combineNames names) withRequired
    pure $ Tuple className $ fromObject withTitle

irToJson :: Doc Json
irToJson = do
    classes <- getClasses
    definitions <- fromObject <$> SM.fromFoldable <$> mapM definitionForClass classes
    -- FIXME: give a title to top-levels, too
    topLevel <- strMapForOneOfTypes =<< M.values <$> getTopLevels
    let sm = SM.insert "definitions" definitions topLevel
    pure $ fromObject sm

jsonSchemaDoc :: Doc Unit
jsonSchemaDoc = do
    json <- irToJson
    line $ stringifyWithSpace "    " json
