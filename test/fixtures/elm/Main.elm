port module Main exposing (..)

import Json.Decode exposing (decodeString, errorToString)
import QuickType



-- Ports


port fromJS : (String -> msg) -> Sub msg


port toJS : String -> Cmd msg



-- Types


type Msg
    = FromJS String



-- Functions


main : Program () () Msg
main =
    Platform.worker
        { init = \_ -> ( (), Cmd.none )
        , update = update
        , subscriptions = subscriptions
        }


update : Msg -> () -> ( (), Cmd Msg )
update msg _ =
    case msg of
        FromJS str ->
            case decodeString QuickType.quickType str of
                Ok r ->
                    ( (), toJS (QuickType.quickTypeToString r) )

                Err err ->
                    ( (), toJS ("Error: " ++ errorToString err) )


subscriptions : () -> Sub Msg
subscriptions _ =
    fromJS FromJS
