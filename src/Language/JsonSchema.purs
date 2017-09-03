module Language.JsonSchema where

import Core (class Eq, class Ord, Error, Unit, bind, const, map, not, otherwise, pure, ($), (&&), (/=), (<), (<$>), (<>), (=<<), (>=), (>>>))

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
import Utils (mapM, mapMapM)

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

newtype JSONSchemaRef = JSONSchemaRef (NEL.NonEmptyList String)

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

decodeEnum :: forall a. StrMap a -> Json -> Either Error a
decodeEnum sm j = do
    key <- decodeJson j
    maybe (Left "Unexpected enum key") Right $ SM.lookup key sm

instance decodeJsonType :: DecodeJson JSONType where
    decodeJson = decodeEnum jsonTypeEnumMap

instance decodeJsonSchemaRef :: DecodeJson JSONSchemaRef where
    decodeJson j = do
        ref <- decodeJson j
        case NEL.fromFoldable $ String.split (String.Pattern "/") ref of
            Just nel -> pure $ JSONSchemaRef nel
            Nothing -> Left "ERROR: String.split should return at least one element."

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

lookupRef :: JSONSchema -> List String -> JSONSchema -> Either Error JSONSchema
lookupRef root ref local@(JSONSchema { definitions }) =
    case ref of
    L.Nil -> Right local
    "#" : rest -> lookupRef root rest root
    "definitions" : name : rest ->
        case definitions of
        Just sm ->
            case SM.lookup name sm of
            Just js -> lookupRef root rest js
            Nothing -> Left "Reference not found"
        Nothing -> Left "Definitions not found"
    _ -> Left "Reference not supported"

toIRAndUnify :: forall a f. Foldable f => (a -> IR IRType) -> f a -> IR IRType
toIRAndUnify toIR l = do
    irs <- mapM toIR $ L.fromFoldable l
    foldM unifyTypes IRNothing irs

jsonSchemaToIR :: JSONSchema -> Named String -> JSONSchema -> IR IRType
jsonSchemaToIR root name schema@(JSONSchema { definitions, ref, types, oneOf, properties, additionalProperties, items, required })
    | Just (JSONSchemaRef r) <- ref =
        case lookupRef root (NEL.toList r) schema of
        Left err -> throwError err
        Right js -> jsonSchemaToIR root (Given $ NEL.last r) js
    | Just (Left jt) <- types =
        jsonTypeToIR root name jt schema
    | Just (Right jts) <- types =
        toIRAndUnify (\jt -> jsonTypeToIR root name jt schema) jts
    | Just jss <- oneOf =
        toIRAndUnify (jsonSchemaToIR root name) jss
    | otherwise =
        pure IRNothing

jsonSchemaListToIR :: forall t. Traversable t => Named String -> t JSONSchema -> IR IRType
jsonSchemaListToIR name l = do
    irTypes <- mapM (\js -> jsonSchemaToIR js name js) l
    foldM unifyTypes IRNothing irTypes

jsonTypeToIR :: JSONSchema -> Named String -> JSONType -> JSONSchema -> IR IRType
jsonTypeToIR root name jsonType (JSONSchema schema) =
    case jsonType of
    JSONObject ->
        case schema.properties of
        Just sm -> do
            let propMap = M.fromFoldable $ SM.toUnfoldable sm :: Array (Tuple String JSONSchema)
            props <- mapMapM (\n -> jsonSchemaToIR root $ Inferred n) propMap
            let required = maybe S.empty S.fromFoldable schema.required
            let title = maybe name Given schema.title
            nulled <- mapMapM (\n -> if S.member n required then pure else unifyTypes IRNull) props
            addClass $ makeClass title nulled
        Nothing ->
            case schema.additionalProperties of
            Left true ->
                pure $ IRMap IRNothing
            Left false ->
                pure $ IRNothing
            Right js -> do
                ir <- jsonSchemaToIR root singularName js
                pure $ IRMap ir
    JSONArray ->
        case schema.items of
        Just js -> do
            ir <- (jsonSchemaToIR root singularName) js
            pure $ IRArray ir
        Nothing -> pure $ IRArray IRNothing
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
    IRNothing -> pure $ SM.empty
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
